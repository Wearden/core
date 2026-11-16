package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/Wearden/core/internal/security"
	"golang.org/x/crypto/ssh"
)

// Remote agent installation. An administrator who already stored a host credential
// can have core sign in over SSH once and run the fixed agent installer. Scans and
// hardening still run only through the enrolled agent: core sends no audit or
// remediation commands over this channel, only the installer below.
//
// The host key is confirmed by the administrator before the credential is sent and
// is pinned afterwards. Windows hosts need the OpenSSH server; RDP cannot carry
// commands, so it stays limited to recorded interactive sessions.
const (
	hostKeysCollection      = "ssh_host_keys"
	agentInstallsCollection = "agent_installs"
	linuxAgentBinary        = "wearden-agent-linux-amd64"
	windowsAgentBinary      = "wearden-agent-windows-amd64.exe"
)

var installTokenRE = regexp.MustCompile(`^[A-Za-z0-9._-]{16,256}$`)

// Bounds concurrent outbound SSH work started from the API.
var remoteInstallSlots = make(chan struct{}, 2)

var errHostKeyProbe = errors.New("host key captured")

// installFailure carries a message that is safe to show to the administrator.
type installFailure struct{ message string }

func (e installFailure) Error() string { return e.message }

type boundedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
	max int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if room := b.max - b.buf.Len(); room > 0 {
		if len(p) > room {
			b.buf.Write(p[:room])
		} else {
			b.buf.Write(p)
		}
	}
	return len(p), nil
}

func (b *boundedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func sshDial(ctx context.Context, addr string, cfg *ssh.ClientConfig) (*ssh.Client, error) {
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		conn.Close()
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	return ssh.NewClient(c, chans, reqs), nil
}

// sshProbeHostKey reads the presented host key and stops before any authentication.
func sshProbeHostKey(ctx context.Context, addr, user string) (fingerprint, keyType string, err error) {
	cfg := &ssh.ClientConfig{User: user, Timeout: 10 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint, keyType = ssh.FingerprintSHA256(key), key.Type()
		return errHostKeyProbe
	}}
	client, err := sshDial(ctx, addr, cfg)
	if client != nil {
		client.Close()
	}
	if fingerprint != "" {
		return fingerprint, keyType, nil
	}
	if err == nil {
		err = errors.New("host key was not presented")
	}
	return "", "", err
}

func sshRun(ctx context.Context, client *ssh.Client, command string, stdin []byte, out *boundedBuffer) error {
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	session.Stdin = bytes.NewReader(stdin)
	session.Stdout = out
	session.Stderr = out
	done := make(chan error, 1)
	go func() { done <- session.Run(command) }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		client.Close()
		<-done
		return ctx.Err()
	}
}

// installLinux runs the installer that core already serves at /install-agent.sh.
// The password, when sudo asks for one, travels on standard input only.
func installLinux(ctx context.Context, client *ssh.Client, password []byte, base, token string, remediation bool, out *boundedBuffer) error {
	flag := ""
	if remediation {
		flag = " --allow-remediation"
	}
	script := "set -eu\ntmp=\"$(mktemp)\"\ntrap 'rm -f \"$tmp\"' EXIT\ncurl -fsSL '" + base + "/install-agent.sh' -o \"$tmp\"\nsh \"$tmp\" --token '" + token + "'" + flag + "\n"
	uid := &boundedBuffer{max: 64}
	if err := sshRun(ctx, client, "id -u", nil, uid); err != nil {
		return installFailure{"Cannot determine the remote account; a POSIX shell is required"}
	}
	if strings.TrimSpace(uid.String()) == "0" {
		return sshRun(ctx, client, "sh -s", []byte(script), out)
	}
	if sshRun(ctx, client, "sudo -n true", nil, &boundedBuffer{max: 256}) == nil {
		return sshRun(ctx, client, "sudo -n sh -s", []byte(script), out)
	}
	if password == nil {
		return installFailure{"The account needs passwordless sudo when an SSH key is stored"}
	}
	if bytes.ContainsAny(password, "\r\n") {
		return installFailure{"The stored password contains a line break and cannot be passed to sudo"}
	}
	stdin := make([]byte, 0, len(password)+1+len(script))
	stdin = append(append(append(stdin, password...), '\n'), script...)
	defer clear(stdin)
	return sshRun(ctx, client, "sudo -S -p '' sh -s", stdin, out)
}

// The enrollment token is read from standard input, never from the command line,
// and is written into the private bootstrap file that the service installer created.
const windowsInstallScript = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$token = [string](@($input)[0])
if (-not $token) { throw 'enrollment token was not received' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = '__BASE__'
$name = '__BINARY__'
$dir = Join-Path $env:TEMP ('wearden-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
try {
  $exe = Join-Path $dir 'agent.exe'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/downloads/$name" -OutFile $exe
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/downloads/SHA256SUMS").Content
  if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
  $expected = $null
  foreach ($line in ($sums -split '\r?\n')) {
    $parts = $line.Trim() -split '\s+'
    if ($parts.Count -ge 2 -and $parts[-1] -eq $name) { $expected = $parts[0].ToLower() }
  }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLower()
  if (-not $expected -or $expected -ne $actual) { throw 'checksum mismatch, nothing was installed' }
  & $exe service install --server $base --confirm __REMEDIATION__
  if ($LASTEXITCODE -ne 0) { throw "service install failed with exit code $LASTEXITCODE" }
  $bootstrap = Join-Path $env:ProgramData 'WeardenAgent\enrollment-token.txt'
  [IO.File]::WriteAllText($bootstrap, $token, [Text.Encoding]::ASCII)
  & $exe service start
  if ($LASTEXITCODE -ne 0) { throw "service start failed with exit code $LASTEXITCODE" }
  'Wearden agent installed. It enrolls itself and appears under Assets.'
} finally {
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
`

func installWindows(ctx context.Context, client *ssh.Client, base, token string, remediation bool, out *boundedBuffer) error {
	flag := ""
	if remediation {
		flag = "--allow-remediation"
	}
	script := strings.NewReplacer("__BASE__", base, "__BINARY__", windowsAgentBinary, "__REMEDIATION__", flag).Replace(windowsInstallScript)
	units := utf16.Encode([]rune(script))
	raw := make([]byte, len(units)*2)
	for i, u := range units {
		binary.LittleEndian.PutUint16(raw[i*2:], u)
	}
	command := "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + base64.StdEncoding.EncodeToString(raw)
	if len(command) > 8000 {
		return installFailure{"The Windows installer command exceeds the command line limit"}
	}
	return sshRun(ctx, client, command, []byte(token+"\n"), out)
}

func installOutput(out *boundedBuffer, secrets ...string) string {
	text := out.String()
	for _, s := range secrets {
		if s != "" {
			text = strings.ReplaceAll(text, s, "[redacted]")
		}
	}
	text = strings.ToValidUTF8(text, "?")
	if len(text) > 4000 {
		text = text[len(text)-4000:]
	}
	return strings.TrimSpace(text)
}

func (s *Server) remoteInstallRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /api/assets/{id}/install-agent", s.requirePerm("agents.enroll", s.installAgentRemote))
}

func (s *Server) installAgentRemote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Benchmark        string `json:"benchmark_id"`
		AllowRemediation bool   `json:"allow_remediation"`
		HostKey          string `json:"host_key"`
		ReplaceHostKey   bool   `json:"replace_host_key"`
	}
	if !decode(w, r, &in) {
		return
	}
	assetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || assetID < 1 {
		problem(w, 400, "Invalid asset id")
		return
	}
	base := s.publicURL(r)
	if !strings.HasPrefix(base, "https://") || strings.ContainsAny(base, "'\"\\$`\n\r ") {
		problem(w, 409, "Remote agent installation needs an HTTPS PUBLIC_ORIGIN that the host can reach; agents refuse plain HTTP to a core that is not on loopback")
		return
	}
	var raw, encrypted []byte
	var username, authType string
	err = s.DB.QueryRowContext(r.Context(), "SELECT a.data,c.username,c.auth_type,c.encrypted FROM assets a JOIN credentials c ON c.asset_id=a.id WHERE a.id=$1", assetID).Scan(&raw, &username, &authType, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "Asset or stored credential not found")
		return
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	var asset map[string]any
	if err := json.Unmarshal(raw, &asset); err != nil {
		s.databaseError(w, err)
		return
	}
	osType := text(asset["os_type"])
	agentBinary := map[string]string{"linux": linuxAgentBinary, "windows": windowsAgentBinary}[osType]
	if agentBinary == "" {
		problem(w, 400, "Unsupported asset OS")
		return
	}
	b := s.Catalog[in.Benchmark]
	if b == nil || len(b.Native) == 0 || b.OS != osType {
		problem(w, 400, "Select a native benchmark matching the host OS")
		return
	}
	if !s.downloadAvailable(agentBinary) || !s.downloadAvailable("SHA256SUMS") {
		problem(w, 409, "The agent binary for this OS and SHA256SUMS are not published in the downloads directory")
		return
	}
	var enrolled bool
	if err := s.DB.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM agents WHERE asset_id=$1 AND NOT revoked)", assetID).Scan(&enrolled); err != nil {
		s.databaseError(w, err)
		return
	}
	if enrolled {
		problem(w, 409, "This host already has an enrolled agent; revoke it before installing again")
		return
	}
	port := integer(asset["ssh_port"])
	if port == 0 {
		port = 22
	}
	addr := net.JoinHostPort(text(asset["host"]), strconv.FormatInt(port, 10))
	target := strconv.FormatInt(assetID, 10)
	select {
	case remoteInstallSlots <- struct{}{}:
		defer func() { <-remoteInstallSlots }()
	default:
		problem(w, 429, "Another remote installation is running; try again shortly")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()

	presented, keyType, err := sshProbeHostKey(ctx, addr, username)
	if err != nil {
		s.audit(r, "agent.remote_install", target, false, "SSH unreachable")
		problem(w, 502, "Cannot reach an SSH server on "+addr)
		return
	}
	pinned := ""
	if doc, err := s.Store.Get(ctx, hostKeysCollection, target); err == nil && text(doc["address"]) == addr {
		pinned = text(doc["fingerprint"])
	}
	changed := pinned != "" && pinned != presented
	if (changed && !(in.ReplaceHostKey && in.HostKey == presented)) || (pinned == "" && in.HostKey != presented) {
		if changed {
			s.audit(r, "agent.remote_install", target, false, "SSH host key changed")
		}
		writeJSON(w, 200, map[string]any{"status": "confirm_host_key", "host_key": presented, "host_key_type": keyType, "host_key_changed": changed})
		return
	}

	secret, err := security.Open(s.Config.VaultKey, encrypted)
	if err != nil {
		problem(w, 503, "Cannot decrypt host credential")
		return
	}
	defer clear(secret)
	var auth []ssh.AuthMethod
	var password []byte
	switch authType {
	case "password":
		password = secret
		value := string(secret)
		auth = []ssh.AuthMethod{ssh.Password(value), ssh.KeyboardInteractive(func(_, _ string, questions []string, _ []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range answers {
				answers[i] = value
			}
			return answers, nil
		})}
	case "ssh_key":
		signer, err := ssh.ParsePrivateKey(secret)
		if err != nil {
			problem(w, 400, "The stored SSH key cannot be parsed; passphrase protected keys are not supported")
			return
		}
		auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	default:
		problem(w, 400, "Unsupported SSH credential type")
		return
	}
	cfg := &ssh.ClientConfig{User: username, Auth: auth, Timeout: 10 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != presented {
			return errors.New("host key differs from the confirmed key")
		}
		return nil
	}}
	client, err := sshDial(ctx, addr, cfg)
	if err != nil {
		s.audit(r, "agent.remote_install", target, false, "SSH sign-in failed")
		writeJSON(w, 200, map[string]any{"status": "failed", "detail": "SSH sign-in failed; check the stored credential and that the account may sign in", "host_key": presented})
		return
	}
	defer client.Close()
	if pinned != presented {
		if err := s.Store.Put(ctx, hostKeysCollection, target, map[string]any{"address": addr, "fingerprint": presented, "key_type": keyType, "confirmed_by": current(r).Username, "confirmed_at": now()}); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "agent.host_key_confirmed", target, true, presented)
	}

	token, err := security.Random()
	if err != nil || !installTokenRE.MatchString(token) {
		problem(w, 500, "Cannot generate enrollment token")
		return
	}
	expires := time.Now().UTC().Add(15 * time.Minute)
	if _, err = s.DB.ExecContext(ctx, "INSERT INTO enrollment_tokens(hash,os,benchmark_id,expires_at,created_by) VALUES($1,$2,$3,$4,$5)", digest(token), osType, in.Benchmark, expires, current(r).Username); err == nil {
		// Binds the enrollment to this asset so the agent does not create a duplicate host.
		err = s.Store.Put(ctx, agentInstallsCollection, digest(token), map[string]any{"asset_id": assetID, "created_at": now()})
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "agent.enrollment_token_created", in.Benchmark, true, "remote install")

	out := &boundedBuffer{max: 16 << 10}
	var runErr error
	if osType == "linux" {
		runErr = installLinux(ctx, client, password, base, token, in.AllowRemediation, out)
	} else {
		runErr = installWindows(ctx, client, base, token, in.AllowRemediation, out)
	}
	log := installOutput(out, token, string(secret))
	if runErr != nil {
		// An unused token must not outlive a failed installation.
		cleanup, done := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer done()
		if res, e := s.DB.ExecContext(cleanup, "DELETE FROM enrollment_tokens WHERE hash=$1 AND remaining>0", digest(token)); e == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				_, _ = s.DB.ExecContext(cleanup, "DELETE FROM documents WHERE collection=$1 AND id=$2", agentInstallsCollection, digest(token))
			}
		}
		detail := "The remote installer reported an error"
		var failure installFailure
		if errors.As(runErr, &failure) {
			detail = failure.message
		} else if errors.Is(runErr, context.DeadlineExceeded) || errors.Is(runErr, context.Canceled) {
			detail = "The remote installation did not finish in time"
		}
		s.auditDetached(r, "agent.remote_install", target, false, detail)
		writeJSON(w, 200, map[string]any{"status": "failed", "detail": detail, "output": log, "host_key": presented})
		return
	}
	s.audit(r, "agent.remote_install", target, true, osType)
	writeJSON(w, 200, map[string]any{"status": "installed", "output": log, "host_key": presented, "expires_at": expires})
}

// auditDetached records an event even when the request context has already expired.
func (s *Server) auditDetached(r *http.Request, action, target string, success bool, detail string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	defer cancel()
	s.audit(r.WithContext(ctx), action, target, success, detail)
}
