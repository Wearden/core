package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/masterzen/winrm"
	"golang.org/x/crypto/ssh"
)

// PAM transports. A PAM asset is managed without an agent: core signs in with the
// stored credential over SSH (Linux, or Windows with the OpenSSH server) or WinRM
// (Windows) and runs the audit, backup, remediation and restore scripts from the
// reviewed benchmark YAML. Nothing typed by a user is ever sent to a host.

// pamResult is the outcome of one script on a host.
type pamResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// pamConn is an open privileged connection to one host.
type pamConn interface {
	// Run executes a script as root (Linux, bash) or administrator (Windows, PowerShell).
	Run(ctx context.Context, script string, timeout time.Duration) (pamResult, error)
	Close() error
}

// pamTransportError is a connection or transport failure. Its message is safe to
// show and never contains secrets.
type pamTransportError struct{ message string }

func (e pamTransportError) Error() string { return e.message }

const pamOutputLimit = 256 << 10

// --- SSH ---

type pamSSH struct {
	client   *ssh.Client
	password []byte
	windows  bool
	once     sync.Once
	prefix   string
	modeErr  error
}

// dialPAMSSH signs in and accepts only the pinned host key fingerprint.
func dialPAMSSH(ctx context.Context, addr, username, authType string, secret []byte, fingerprint string, windows bool) (*pamSSH, error) {
	if fingerprint == "" {
		return nil, pamTransportError{"No confirmed SSH host key for this asset; run Test connection first"}
	}
	auth, password, err := sshAuthMethods(authType, secret)
	if err != nil {
		return nil, pamTransportError{err.Error()}
	}
	cfg := &ssh.ClientConfig{User: username, Auth: auth, Timeout: 10 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != fingerprint {
			return errors.New("host key changed")
		}
		return nil
	}}
	client, err := sshDial(ctx, addr, cfg)
	if err != nil {
		if strings.Contains(err.Error(), "host key changed") {
			return nil, pamTransportError{"The SSH host key changed since it was confirmed; verify the server and confirm the new key with Test connection"}
		}
		if strings.Contains(err.Error(), "unable to authenticate") {
			return nil, pamTransportError{"SSH authentication failed"}
		}
		return nil, pamTransportError{"Cannot reach " + addr + " over SSH"}
	}
	c := &pamSSH{client: client, windows: windows}
	if password != nil {
		c.password = append([]byte{}, password...)
	}
	return c, nil
}

func sshExec(ctx context.Context, client *ssh.Client, command string, stdin []byte, timeout time.Duration) (pamResult, error) {
	session, err := client.NewSession()
	if err != nil {
		return pamResult{}, pamTransportError{"SSH connection lost"}
	}
	defer session.Close()
	var stdout, stderr boundedBuffer
	stdout.max, stderr.max = pamOutputLimit, pamOutputLimit
	session.Stdin = bytes.NewReader(stdin)
	session.Stdout = &stdout
	session.Stderr = &stderr
	done := make(chan error, 1)
	go func() { done <- session.Run(command) }()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err = <-done:
	case <-timer.C:
		_ = session.Signal(ssh.SIGKILL)
		session.Close()
		return pamResult{Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: -1}, pamTransportError{"command timed out"}
	case <-ctx.Done():
		session.Close()
		return pamResult{}, ctx.Err()
	}
	res := pamResult{Stdout: stdout.String(), Stderr: stderr.String()}
	var exitErr *ssh.ExitError
	switch {
	case err == nil:
	case errors.As(err, &exitErr):
		res.ExitCode = exitErr.ExitStatus()
	default:
		return res, pamTransportError{"SSH connection lost"}
	}
	return res, nil
}

// privilege decides once how to reach root: directly, passwordless sudo, or sudo
// with the stored password on standard input.
func (c *pamSSH) privilege(ctx context.Context) (string, error) {
	c.once.Do(func() {
		if c.windows {
			return
		}
		uid, err := sshExec(ctx, c.client, "id -u", nil, 15*time.Second)
		if err != nil {
			c.modeErr = err
			return
		}
		if strings.TrimSpace(uid.Stdout) == "0" {
			return
		}
		if res, err := sshExec(ctx, c.client, "sudo -n true", nil, 15*time.Second); err == nil && res.ExitCode == 0 {
			c.prefix = "sudo -n "
			return
		}
		if c.password == nil || bytes.ContainsAny(c.password, "\r\n") {
			c.modeErr = pamTransportError{"The account is not root and has no passwordless sudo; store its password or allow sudo"}
			return
		}
		c.prefix = "sudo -S -p '' "
	})
	return c.prefix, c.modeErr
}

func (c *pamSSH) Run(ctx context.Context, script string, timeout time.Duration) (pamResult, error) {
	if c.windows {
		return sshExec(ctx, c.client, "powershell.exe "+strings.Join(pamPowershellArgs(), " "), pamPowershellStdin(script), timeout)
	}
	prefix, err := c.privilege(ctx)
	if err != nil {
		return pamResult{}, err
	}
	stdin := []byte(script + "\n")
	if prefix == "sudo -S -p '' " {
		stdin = append(append(append([]byte{}, c.password...), '\n'), stdin...)
		defer clear(stdin)
	}
	res, err := sshExec(ctx, c.client, prefix+"bash -s", stdin, timeout)
	if err == nil && prefix == "sudo -S -p '' " && res.ExitCode == 1 && strings.Contains(res.Stderr, "incorrect password") {
		return res, pamTransportError{"sudo rejected the stored password"}
	}
	return res, err
}

func (c *pamSSH) Close() error {
	clear(c.password)
	return c.client.Close()
}

// --- WinRM ---

type pamWinRM struct{ client *winrm.Client }

// dialPAMWinRM signs in with NTLM and seals every WinRM message (MS-NLMP). HTTPS on
// the WinRM HTTPS port is used when the asset has one configured.
func dialPAMWinRM(ctx context.Context, host string, port int, https bool, username, password string) (*pamWinRM, error) {
	endpoint := winrm.NewEndpoint(host, port, https, https, nil, nil, nil, 120*time.Second)
	params := winrm.NewParameters("PT120S", "en-US", 153600)
	if !https {
		params.TransportDecorator = func() winrm.Transporter {
			enc, err := winrm.NewEncryption("ntlm")
			if err != nil {
				return &winrm.ClientNTLM{}
			}
			return enc
		}
	} else {
		params.TransportDecorator = func() winrm.Transporter { return &winrm.ClientNTLM{} }
	}
	client, err := winrm.NewClientWithParameters(endpoint, username, password, params)
	if err != nil {
		return nil, pamTransportError{"WinRM connection failed"}
	}
	c := &pamWinRM{client: client}
	probe, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	res, err := c.Run(probe, "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)", 60*time.Second)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "401") || strings.Contains(strings.ToLower(err.Error()), "unauthorized") {
			return nil, pamTransportError{"WinRM authentication failed"}
		}
		return nil, pamTransportError{"WinRM connection failed; check that WinRM is enabled and reachable"}
	}
	if strings.TrimSpace(res.Stdout) != "True" {
		return nil, pamTransportError{"The WinRM account is not an administrator"}
	}
	return c, nil
}

func (c *pamWinRM) Run(ctx context.Context, script string, timeout time.Duration) (pamResult, error) {
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	shell, err := c.client.CreateShell()
	if err != nil {
		return pamResult{}, pamTransportError{"WinRM connection lost: " + err.Error()}
	}
	defer shell.Close()
	cmd, err := shell.ExecuteWithContext(rctx, "powershell.exe", pamPowershellArgs()...)
	if err != nil {
		return pamResult{}, pamTransportError{"WinRM command failed"}
	}
	defer cmd.Close()
	var stdout, stderr boundedBuffer
	stdout.max, stderr.max = pamOutputLimit, pamOutputLimit
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = io.Copy(&stdout, cmd.Stdout) }()
	go func() { defer wg.Done(); _, _ = io.Copy(&stderr, cmd.Stderr) }()
	if _, err = cmd.Stdin.Write(pamPowershellStdin(script)); err == nil {
		err = cmd.Stdin.Close()
	}
	cmd.Wait()
	wg.Wait()
	res := pamResult{Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: cmd.ExitCode()}
	if rctx.Err() != nil {
		return res, pamTransportError{"command timed out"}
	}
	if err != nil {
		return res, pamTransportError{"WinRM connection lost"}
	}
	return res, nil
}

func (c *pamWinRM) Close() error { return nil }

// pamPowershellBootstrap reads the real script as one base64 line from standard input,
// which keeps the command line short. Output objects are written as strings; an error
// written to the error stream makes the exit code 1, like a PowerShell remoting call
// that reports errors. Errors suppressed with SilentlyContinue do not count.
const pamPowershellBootstrap = `$l=[Console]::In.ReadLine();$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($l));$global:wdf=$false;try{& ([ScriptBlock]::Create($s)) 2>&1 | ForEach-Object {if($_ -is [Management.Automation.ErrorRecord]){$global:wdf=$true;[Console]::Error.WriteLine($_.ToString())}else{[Console]::Out.WriteLine([string]$_)}}}catch{[Console]::Error.WriteLine($_.ToString());exit 1};if($global:wdf){exit 1};exit 0`

func pamPowershellArgs() []string {
	units := utf16.Encode([]rune(pamPowershellBootstrap))
	raw := make([]byte, len(units)*2)
	for i, u := range units {
		binary.LittleEndian.PutUint16(raw[i*2:], u)
	}
	return []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64.StdEncoding.EncodeToString(raw)}
}

func pamPowershellStdin(script string) []byte {
	return []byte(base64.StdEncoding.EncodeToString([]byte(script)) + "\n")
}

// --- opening a connection for an asset ---

type pamTarget struct {
	AssetID  int64
	Name     string
	Host     string
	OS       string
	Protocol string // ssh or winrm
	addr     string
	port     int
	https    bool
	username string
	authType string
	secret   []byte
	pinned   string
}

func pamWinRMPort(asset map[string]any) (int, bool) {
	if p := int(integer(asset["winrm_https_port"])); p > 0 && p < 65536 && text(asset["winrm_transport"]) == "https" {
		return p, true
	}
	p := int(integer(asset["winrm_port"]))
	if p < 1 || p > 65535 {
		p = 5985
	}
	return p, false
}

func (t *pamTarget) open(ctx context.Context) (pamConn, error) {
	if t.Protocol == "winrm" {
		if t.authType != "password" {
			return nil, pamTransportError{"WinRM requires a password credential"}
		}
		return dialPAMWinRM(ctx, t.Host, t.port, t.https, t.username, string(t.secret))
	}
	return dialPAMSSH(ctx, t.addr, t.username, t.authType, t.secret, t.pinned, t.OS == "windows")
}

func (t *pamTarget) wipe() { clear(t.secret) }

// pamTargetFor loads a PAM asset with its decrypted credential and pinned host key.
func (s *Server) pamTargetFor(ctx context.Context, assetID int64) (*pamTarget, error) {
	asset, username, authType, secret, err := s.assetCredential(ctx, assetID)
	if err != nil {
		return nil, err
	}
	return s.pamTargetWith(ctx, assetID, asset, username, authType, secret)
}

// pamTargetWith builds a PAM target from an asset and an already decrypted credential.
func (s *Server) pamTargetWith(ctx context.Context, assetID int64, asset map[string]any, username, authType string, secret []byte) (*pamTarget, error) {
	t := &pamTarget{AssetID: assetID, Name: text(asset["name"]), Host: text(asset["host"]), OS: text(asset["os_type"]), Protocol: assetConnection(asset), username: username, authType: authType, secret: secret}
	switch t.Protocol {
	case "ssh":
		t.addr = sshAddress(asset)
		if doc, err := s.Store.Get(ctx, hostKeysCollection, strconv.FormatInt(assetID, 10)); err == nil && text(doc["address"]) == t.addr {
			t.pinned = text(doc["fingerprint"])
		}
	case "winrm":
		t.port, t.https = pamWinRMPort(asset)
	default:
		clear(secret)
		return nil, pamTransportError{"This asset is managed by an installed agent, not by PAM"}
	}
	return t, nil
}
