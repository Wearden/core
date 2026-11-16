package app

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/masterzen/winrm"
	"golang.org/x/crypto/ssh"
)

// Transports for agentless (PAM based) runs. Core signs in to the host with the
// stored credential, makes its agent endpoints reachable at a loopback address on
// the host, and starts the reviewed agent there only for the duration of the run.
// The agent then talks to core exactly as an installed agent would, so scans,
// hardening, backups and rollback use the same typed tasks. No audit or remediation
// command text is ever sent over the connection, only the fixed scripts in agentless.go.

// pamTarget is an open privileged connection to one host.
type pamTarget interface {
	// Script runs a fixed management script as root or administrator. stdin is
	// delivered after the script, so secrets never appear on a command line.
	Script(ctx context.Context, script string, stdin []byte) (string, error)
	// Tunnel serves handler at 127.0.0.1:port on the host until the closer is called.
	Tunnel(ctx context.Context, port int, handler http.Handler) (io.Closer, error)
	Close() error
}

// powershellBootstrap reads the real script as one base64 line from standard input,
// which keeps the command line short; the script can read further input lines itself.
const powershellBootstrap = `$l=[Console]::In.ReadLine();$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($l));& ([ScriptBlock]::Create($s))`

func powershellArgs() []string {
	units := utf16.Encode([]rune(powershellBootstrap))
	raw := make([]byte, len(units)*2)
	for i, u := range units {
		binary.LittleEndian.PutUint16(raw[i*2:], u)
	}
	return []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64.StdEncoding.EncodeToString(raw)}
}

func powershellStdin(script string, stdin []byte) []byte {
	out := []byte(base64.StdEncoding.EncodeToString([]byte(script)) + "\n")
	return append(out, stdin...)
}

// --- SSH (Linux, and Windows hosts running the OpenSSH server) ---

type sshTarget struct {
	client   *ssh.Client
	windows  bool
	password []byte
}

func (t *sshTarget) Script(ctx context.Context, script string, stdin []byte) (string, error) {
	out := &boundedBuffer{max: 64 << 10}
	var err error
	if t.windows {
		err = sshRun(ctx, t.client, "powershell.exe "+strings.Join(powershellArgs(), " "), powershellStdin(script, stdin), out)
	} else {
		err = linuxAsRoot(ctx, t.client, t.password, script, out)
	}
	return out.String(), err
}

// Tunnel asks the SSH server to listen on the host's loopback interface and serves
// every forwarded connection with handler (remote port forwarding, like ssh -R).
func (t *sshTarget) Tunnel(_ context.Context, port int, handler http.Handler) (io.Closer, error) {
	listener, err := t.client.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return nil, installFailure{"The SSH server refused to open the agent tunnel; allow TCP forwarding for this account and make sure port " + strconv.Itoa(port) + " is free on the host"}
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 30 * time.Second}
	go func() { _ = server.Serve(listener) }()
	return closerFunc(func() error { return server.Close() }), nil
}

func (t *sshTarget) Close() error {
	clear(t.password)
	return t.client.Close()
}

// --- WinRM (Windows) ---

type winrmTarget struct{ client *winrm.Client }

// dialWinRM signs in with NTLM and seals every WinRM message (MS-NLMP), so the
// plain HTTP listener on port 5985 does not expose the credential or the traffic.
func dialWinRM(ctx context.Context, host string, port int, username, password string) (*winrmTarget, error) {
	endpoint := winrm.NewEndpoint(host, port, false, false, nil, nil, nil, 90*time.Second)
	params := winrm.NewParameters("PT60S", "en-US", 153600)
	params.TransportDecorator = func() winrm.Transporter {
		enc, err := winrm.NewEncryption("ntlm")
		if err != nil {
			return &winrm.ClientNTLM{}
		}
		return enc
	}
	client, err := winrm.NewClientWithParameters(endpoint, username, password, params)
	if err != nil {
		return nil, err
	}
	t := &winrmTarget{client: client}
	probe, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if _, err := t.Script(probe, "$ErrorActionPreference='Stop'; if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'the account is not an administrator' }; 'ok'", nil); err != nil {
		var failure installFailure
		if errors.As(err, &failure) {
			return nil, err
		}
		return nil, installFailure{"WinRM sign-in failed; check the stored credential, that WinRM is enabled and that the account is an administrator"}
	}
	return t, nil
}

func (t *winrmTarget) Script(ctx context.Context, script string, stdin []byte) (string, error) {
	shell, err := t.client.CreateShell()
	if err != nil {
		return "", err
	}
	defer shell.Close()
	cmd, err := shell.ExecuteWithContext(ctx, "powershell.exe", powershellArgs()...)
	if err != nil {
		return "", err
	}
	defer cmd.Close()
	out := &boundedBuffer{max: 64 << 10}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = io.Copy(out, cmd.Stdout) }()
	go func() { defer wg.Done(); _, _ = io.Copy(out, cmd.Stderr) }()
	if _, err = cmd.Stdin.Write(powershellStdin(script, stdin)); err == nil {
		err = cmd.Stdin.Close()
	}
	cmd.Wait()
	wg.Wait()
	if err != nil {
		return out.String(), err
	}
	if code := cmd.ExitCode(); code != 0 {
		return out.String(), errors.New("remote script exited with code " + strconv.Itoa(code))
	}
	return out.String(), nil
}

// WinRM cannot forward ports, so a small PowerShell relay listens on the host's
// loopback interface and carries each TCP connection over the command's standard
// streams. Lines are "O id" (opened), "D id base64" (data) and "C id" (closed).
const winrmRelayScript = `$ErrorActionPreference='Stop'
$l=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,__PORT__)
$l.Start()
$o=New-Object IO.StreamWriter([Console]::OpenStandardOutput())
$o.AutoFlush=$true
$q=New-Object 'Collections.Concurrent.BlockingCollection[string]'
$r=[PowerShell]::Create().AddScript({param($q) while($true){$x=[Console]::In.ReadLine();if($null -eq $x){$q.Add('E');break};$q.Add($x)}}).AddArgument($q)
$null=$r.BeginInvoke()
$o.WriteLine('R')
$c=@{};$n=0;$b=New-Object byte[] 24576
while($true){
$busy=$false
if($l.Pending()){$t=$l.AcceptTcpClient();$t.NoDelay=$true;$n++;$c[$n]=$t;$o.WriteLine("O $n");$busy=$true}
foreach($i in @($c.Keys)){$t=$c[$i]
try{$s=$t.GetStream()
if($s.DataAvailable){$k=$s.Read($b,0,$b.Length);if($k -gt 0){$o.WriteLine("D $i "+[Convert]::ToBase64String($b,0,$k));$busy=$true;continue}}
if($t.Client.Poll(0,[Net.Sockets.SelectMode]::SelectRead) -and $t.Client.Available -eq 0){throw 'closed'}
}catch{$o.WriteLine("C $i");$t.Close();$c.Remove($i)}}
$x=$null
while($q.TryTake([ref]$x)){$busy=$true
if($x -eq 'E'){$l.Stop();foreach($t in $c.Values){$t.Close()};exit 0}
$p=$x.Split(' ');$i=[int]$p[1]
if($c.ContainsKey($i)){$t=$c[$i]
if($p[0] -eq 'D'){$d=[Convert]::FromBase64String($p[2]);try{$t.GetStream().Write($d,0,$d.Length)}catch{$o.WriteLine("C $i");$t.Close();$c.Remove($i)}}
elseif($p[0] -eq 'C'){$t.Close();$c.Remove($i)}}}
if(-not $busy){Start-Sleep -Milliseconds 10}
}`

type winrmRelay struct {
	cancel   context.CancelFunc
	shell    *winrm.Shell
	cmd      *winrm.Command
	server   *http.Server
	listener *chanListener
	mu       sync.Mutex
	conns    map[int]*relayConn
	writeMu  sync.Mutex
	closed   bool
}

type relayConn struct {
	pipe  net.Conn
	queue chan []byte
	once  sync.Once
}

func (c *relayConn) shut() {
	c.once.Do(func() {
		close(c.queue)
	})
}

func (t *winrmTarget) Tunnel(ctx context.Context, port int, handler http.Handler) (io.Closer, error) {
	shell, err := t.client.CreateShell()
	if err != nil {
		return nil, err
	}
	rctx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	cmd, err := shell.ExecuteWithContext(rctx, "powershell.exe", powershellArgs()...)
	if err != nil {
		cancel()
		shell.Close()
		return nil, err
	}
	relay := &winrmRelay{cancel: cancel, shell: shell, cmd: cmd, listener: newChanListener(), conns: map[int]*relayConn{}}
	script := strings.Replace(winrmRelayScript, "__PORT__", strconv.Itoa(port), 1)
	if _, err = cmd.Stdin.Write(powershellStdin(script, nil)); err != nil {
		relay.Close()
		return nil, err
	}
	reader := bufio.NewReaderSize(cmd.Stdout, 64<<10)
	ready := make(chan error, 1)
	go func() {
		line, err := reader.ReadString('\n')
		if err != nil || strings.TrimSpace(line) != "R" {
			ready <- installFailure{"The WinRM agent relay did not start; port " + strconv.Itoa(port) + " may be in use on the host"}
			return
		}
		ready <- nil
	}()
	select {
	case err = <-ready:
	case <-time.After(90 * time.Second):
		err = installFailure{"The WinRM agent relay did not start in time"}
	}
	if err != nil {
		relay.Close()
		return nil, err
	}
	go func() { _, _ = io.Copy(io.Discard, cmd.Stderr) }()
	relay.server = &http.Server{Handler: handler, ReadHeaderTimeout: 30 * time.Second}
	go func() { _ = relay.server.Serve(relay.listener) }()
	go relay.readLoop(reader)
	return relay, nil
}

func (r *winrmRelay) send(line string) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	if r.closed {
		return io.ErrClosedPipe
	}
	_, err := r.cmd.Stdin.Write([]byte(line))
	return err
}

func (r *winrmRelay) readLoop(reader *bufio.Reader) {
	defer r.Close()
	for {
		line, err := reader.ReadString('\n')
		if err != nil || len(line) > 1<<20 {
			return
		}
		parts := strings.SplitN(strings.TrimSpace(line), " ", 3)
		if len(parts) < 2 {
			continue
		}
		id, err := strconv.Atoi(parts[1])
		if err != nil || id < 1 {
			continue
		}
		switch parts[0] {
		case "O":
			local, remote := net.Pipe()
			conn := &relayConn{pipe: remote, queue: make(chan []byte, 256)}
			r.mu.Lock()
			r.conns[id] = conn
			r.mu.Unlock()
			go r.pumpOut(id, conn)
			go r.pumpIn(conn)
			if !r.listener.offer(local) {
				conn.shut()
				return
			}
		case "D":
			if len(parts) != 3 {
				continue
			}
			data, err := base64.StdEncoding.DecodeString(parts[2])
			r.mu.Lock()
			conn := r.conns[id]
			r.mu.Unlock()
			if err == nil && conn != nil {
				func() {
					defer func() { _ = recover() }() // queue closed concurrently
					conn.queue <- data
				}()
			}
		case "C":
			r.mu.Lock()
			conn := r.conns[id]
			delete(r.conns, id)
			r.mu.Unlock()
			if conn != nil {
				conn.shut()
			}
		}
	}
}

// pumpOut carries bytes written by core's HTTP server back to the host.
func (r *winrmRelay) pumpOut(id int, conn *relayConn) {
	buf := make([]byte, 24<<10)
	for {
		n, err := conn.pipe.Read(buf)
		if n > 0 {
			if r.send("D "+strconv.Itoa(id)+" "+base64.StdEncoding.EncodeToString(buf[:n])+"\n") != nil {
				conn.pipe.Close()
				return
			}
		}
		if err != nil {
			r.mu.Lock()
			_, open := r.conns[id]
			delete(r.conns, id)
			r.mu.Unlock()
			if open {
				_ = r.send("C " + strconv.Itoa(id) + "\n")
			}
			conn.shut()
			return
		}
	}
}

// pumpIn delivers bytes from the host to core's HTTP server in order.
func (r *winrmRelay) pumpIn(conn *relayConn) {
	for data := range conn.queue {
		if _, err := conn.pipe.Write(data); err != nil {
			break
		}
	}
	conn.pipe.Close()
	for range conn.queue {
	}
}

func (r *winrmRelay) Close() error {
	r.writeMu.Lock()
	if r.closed {
		r.writeMu.Unlock()
		return nil
	}
	r.closed = true
	// End of input tells the relay to stop listening and exit.
	_ = r.cmd.Stdin.Close()
	r.writeMu.Unlock()
	if r.server != nil {
		_ = r.server.Close()
	}
	r.listener.Close()
	r.mu.Lock()
	for id, conn := range r.conns {
		conn.shut()
		delete(r.conns, id)
	}
	r.mu.Unlock()
	done := make(chan struct{})
	go func() { r.cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
	}
	r.cancel()
	_ = r.cmd.Close()
	return r.shell.Close()
}

func (t *winrmTarget) Close() error { return nil }

// chanListener hands relayed connections to an http.Server.
type chanListener struct {
	ch   chan net.Conn
	done chan struct{}
	once sync.Once
}

func newChanListener() *chanListener {
	return &chanListener{ch: make(chan net.Conn), done: make(chan struct{})}
}

func (l *chanListener) offer(c net.Conn) bool {
	select {
	case l.ch <- c:
		return true
	case <-l.done:
		c.Close()
		return false
	}
}

func (l *chanListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}

func (l *chanListener) Close() error {
	l.once.Do(func() { close(l.done) })
	return nil
}

func (l *chanListener) Addr() net.Addr { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)} }

type closerFunc func() error

func (f closerFunc) Close() error { return f() }
