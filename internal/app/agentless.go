package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Wearden/core/internal/security"
	"golang.org/x/crypto/ssh"
)

// Agentless (PAM based) assets. An asset's "connection" is "agent" (an installed
// agent reaches core by itself), "ssh" or "winrm". For ssh and winrm, core keeps
// the reviewed agent installed but stopped on the host. Whenever scans, hardening
// or rollback tasks are queued for that host, core signs in with the stored
// credential, opens a loopback tunnel back to itself, starts the agent, waits until
// the queued work is delivered and stops the agent again. The host never needs a
// network route to core and core never sends audit or remediation commands.
const (
	agentlessTunnelPort  = 47801
	agentlessRunsColl    = "agentless_runs"
	agentlessMaxRun      = 45 * time.Minute
	agentlessEnrollLimit = 5 * time.Minute
	// After the queue is empty, the agent keeps running long enough to receive the
	// result receipts, so its local recovery helper is not left unacknowledged.
	agentlessSettle = 25 * time.Second
)

var agentlessTunnelBase = "http://127.0.0.1:" + strconv.Itoa(agentlessTunnelPort)

func validConnection(osType, connection string) bool {
	switch connection {
	case "agent", "ssh":
		return true
	case "winrm":
		return osType == "windows"
	}
	return false
}

func assetConnection(asset map[string]any) string {
	if c := text(asset["connection"]); c != "" {
		return c
	}
	return "agent"
}

type agentlessSetup struct {
	token       string
	remediation bool
}

type agentlessState struct {
	mu      sync.Mutex
	ctx     context.Context
	running map[int64]bool
	slots   chan struct{}
	handler http.Handler
	once    sync.Once
}

func (s *Server) agentless() *agentlessState {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.agentlessRuns == nil {
		s.agentlessRuns = &agentlessState{running: map[int64]bool{}, slots: make(chan struct{}, 3)}
	}
	return s.agentlessRuns
}

// tunnelHandler exposes only what an agent needs; the management API stays unreachable
// from the host even though the tunnel ends on its loopback interface.
func (s *Server) tunnelHandler() http.Handler {
	st := s.agentless()
	st.once.Do(func() {
		inner := s.Handler()
		st.handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/agent/v1/") || strings.HasPrefix(r.URL.Path, "/downloads/") {
				inner.ServeHTTP(w, r)
				return
			}
			http.NotFound(w, r)
		})
	})
	return st.handler
}

func (s *Server) agentlessRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /api/assets/{id}/agentless/setup", s.requirePerm("agents.enroll", s.agentlessSetupHandler))
	m.HandleFunc("GET /api/assets/{id}/agentless", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id < 1 {
			problem(w, 400, "Invalid asset id")
			return
		}
		st := s.agentless()
		st.mu.Lock()
		running := st.running[id]
		st.mu.Unlock()
		last, err := s.Store.Get(r.Context(), agentlessRunsColl, strconv.FormatInt(id, 10))
		if errors.Is(err, sql.ErrNoRows) {
			last, err = nil, nil
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"running": running, "last": last})
	}))
}

// agentlessCredential loads the asset with its decrypted credential.
func (s *Server) agentlessCredential(ctx context.Context, assetID int64) (map[string]any, string, string, []byte, error) {
	var raw, encrypted []byte
	var username, authType string
	err := s.DB.QueryRowContext(ctx, "SELECT a.data,c.username,c.auth_type,c.encrypted FROM assets a JOIN credentials c ON c.asset_id=a.id WHERE a.id=$1", assetID).Scan(&raw, &username, &authType, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", "", nil, installFailure{"Asset or stored credential not found"}
	}
	if err != nil {
		return nil, "", "", nil, err
	}
	var asset map[string]any
	if err := json.Unmarshal(raw, &asset); err != nil {
		return nil, "", "", nil, err
	}
	secret, err := security.Open(s.Config.VaultKey, encrypted)
	if err != nil {
		return nil, "", "", nil, installFailure{"Cannot decrypt host credential"}
	}
	return asset, username, authType, secret, nil
}

func sshAddress(asset map[string]any) string {
	port := integer(asset["ssh_port"])
	if port == 0 {
		port = 22
	}
	return net.JoinHostPort(text(asset["host"]), strconv.FormatInt(port, 10))
}

// openSSH signs in and accepts only the given host key fingerprint.
func openSSH(ctx context.Context, addr, username, authType string, secret []byte, fingerprint string, windows bool) (*sshTarget, error) {
	auth, password, err := sshAuthMethods(authType, secret)
	if err != nil {
		return nil, installFailure{err.Error()}
	}
	cfg := &ssh.ClientConfig{User: username, Auth: auth, Timeout: 10 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != fingerprint {
			return errors.New("host key differs from the confirmed key")
		}
		return nil
	}}
	client, err := sshDial(ctx, addr, cfg)
	if err != nil {
		return nil, installFailure{"SSH sign-in failed; check the stored credential and the confirmed host key"}
	}
	t := &sshTarget{client: client, windows: windows}
	if password != nil {
		t.password = append([]byte{}, password...)
	}
	return t, nil
}

// openPAM opens the configured connection for a background run. SSH requires the
// host key confirmed during setup.
func (s *Server) openPAM(ctx context.Context, assetID int64) (pamTarget, string, error) {
	asset, username, authType, secret, err := s.agentlessCredential(ctx, assetID)
	if err != nil {
		return nil, "", err
	}
	defer clear(secret)
	osType := text(asset["os_type"])
	switch assetConnection(asset) {
	case "ssh":
		addr := sshAddress(asset)
		pinned := ""
		if doc, err := s.Store.Get(ctx, hostKeysCollection, strconv.FormatInt(assetID, 10)); err == nil && text(doc["address"]) == addr {
			pinned = text(doc["fingerprint"])
		}
		if pinned == "" {
			return nil, osType, installFailure{"No confirmed SSH host key for this asset; run agentless setup first"}
		}
		t, err := openSSH(ctx, addr, username, authType, secret, pinned, osType == "windows")
		return t, osType, err
	case "winrm":
		if authType != "password" {
			return nil, osType, installFailure{"WinRM requires a password credential"}
		}
		port := int(integer(asset["winrm_port"]))
		if port < 1 || port > 65535 {
			port = 5985
		}
		t, err := dialWinRM(ctx, text(asset["host"]), port, username, string(secret))
		return t, osType, err
	}
	return nil, osType, installFailure{"This asset uses an installed agent, not an agentless connection"}
}

func (s *Server) agentlessSetupHandler(w http.ResponseWriter, r *http.Request) {
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
	asset, username, authType, secret, err := s.agentlessCredential(r.Context(), assetID)
	if err != nil {
		var failure installFailure
		if errors.As(err, &failure) {
			problem(w, 404, failure.message)
		} else {
			s.databaseError(w, err)
		}
		return
	}
	defer clear(secret)
	osType := text(asset["os_type"])
	connection := assetConnection(asset)
	if connection != "ssh" && connection != "winrm" {
		problem(w, 400, "Set the asset connection to SSH or WinRM first")
		return
	}
	b := s.Catalog[in.Benchmark]
	if b == nil || len(b.Native) == 0 || b.OS != osType {
		problem(w, 400, "Select a native benchmark matching the host OS")
		return
	}
	binary := map[string]string{"linux": linuxAgentBinary, "windows": windowsAgentBinary}[osType]
	if binary == "" || !s.downloadAvailable(binary) || !s.downloadAvailable("SHA256SUMS") {
		problem(w, 409, "The agent binary for this OS and SHA256SUMS are not published in the downloads directory")
		return
	}
	var enrolled bool
	if err := s.DB.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM agents WHERE asset_id=$1 AND NOT revoked)", assetID).Scan(&enrolled); err != nil {
		s.databaseError(w, err)
		return
	}
	if enrolled {
		problem(w, 409, "This host is already set up; revoke its agent before setting it up again")
		return
	}
	st := s.agentless()
	st.mu.Lock()
	busy := st.running[assetID]
	st.mu.Unlock()
	if busy {
		problem(w, 409, "A run for this host is already in progress")
		return
	}
	target := strconv.FormatInt(assetID, 10)
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	var pam pamTarget
	if connection == "ssh" {
		addr := sshAddress(asset)
		presented, keyType, err := sshProbeHostKey(ctx, addr, username)
		if err != nil {
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
				s.audit(r, "agentless.setup", target, false, "SSH host key changed")
			}
			writeJSON(w, 200, map[string]any{"status": "confirm_host_key", "host_key": presented, "host_key_type": keyType, "host_key_changed": changed})
			return
		}
		t, err := openSSH(ctx, addr, username, authType, secret, presented, osType == "windows")
		if err != nil {
			s.audit(r, "agentless.setup", target, false, "SSH sign-in failed")
			writeJSON(w, 200, map[string]any{"status": "failed", "detail": err.Error()})
			return
		}
		if pinned != presented {
			if err := s.Store.Put(ctx, hostKeysCollection, target, map[string]any{"address": addr, "fingerprint": presented, "key_type": keyType, "confirmed_by": current(r).Username, "confirmed_at": now()}); err != nil {
				t.Close()
				s.databaseError(w, err)
				return
			}
			s.audit(r, "agent.host_key_confirmed", target, true, presented)
		}
		pam = t
	} else {
		if authType != "password" {
			problem(w, 400, "WinRM requires a password credential")
			return
		}
		port := int(integer(asset["winrm_port"]))
		if port < 1 || port > 65535 {
			port = 5985
		}
		t, err := dialWinRM(ctx, text(asset["host"]), port, username, string(secret))
		if err != nil {
			s.audit(r, "agentless.setup", target, false, "WinRM sign-in failed")
			detail := "WinRM sign-in failed"
			var failure installFailure
			if errors.As(err, &failure) {
				detail = failure.message
			}
			writeJSON(w, 200, map[string]any{"status": "failed", "detail": detail})
			return
		}
		pam = t
	}

	token, err := security.Random()
	if err != nil || !installTokenRE.MatchString(token) {
		pam.Close()
		problem(w, 500, "Cannot generate enrollment token")
		return
	}
	expires := time.Now().UTC().Add(30 * time.Minute)
	if _, err = s.DB.ExecContext(ctx, "INSERT INTO enrollment_tokens(hash,os,benchmark_id,expires_at,created_by) VALUES($1,$2,$3,$4,$5)", digest(token), osType, in.Benchmark, expires, current(r).Username); err == nil {
		err = s.Store.Put(ctx, agentInstallsCollection, digest(token), map[string]any{"asset_id": assetID, "created_at": now()})
	}
	if err != nil {
		pam.Close()
		s.databaseError(w, err)
		return
	}
	s.audit(r, "agent.enrollment_token_created", in.Benchmark, true, "agentless setup")
	if !s.startAgentlessRun(assetID, pam, &agentlessSetup{token: token, remediation: in.AllowRemediation}) {
		pam.Close()
		problem(w, 409, "A run for this host is already in progress")
		return
	}
	s.audit(r, "agentless.setup", target, true, connection)
	writeJSON(w, 202, map[string]any{"status": "started"})
}

// startAgentlessRun reserves the asset and runs in the background with the server's
// lifetime context. pam may be nil, in which case the run opens its own connection.
func (s *Server) startAgentlessRun(assetID int64, pam pamTarget, setup *agentlessSetup) bool {
	st := s.agentless()
	st.mu.Lock()
	if st.running[assetID] {
		st.mu.Unlock()
		return false
	}
	st.running[assetID] = true
	st.mu.Unlock()
	go func() {
		defer func() {
			st.mu.Lock()
			delete(st.running, assetID)
			st.mu.Unlock()
		}()
		st.slots <- struct{}{}
		defer func() { <-st.slots }()
		st.mu.Lock()
		ctx := st.ctx
		st.mu.Unlock()
		if ctx == nil {
			ctx = context.Background()
		}
		s.agentlessRun(ctx, assetID, pam, setup)
	}()
	return true
}

func (s *Server) agentlessRecord(assetID int64, doc map[string]any) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.Store.Put(ctx, agentlessRunsColl, strconv.FormatInt(assetID, 10), doc); err != nil {
		slog.Error("agentless run status could not be stored")
	}
}

func (s *Server) agentlessPending(ctx context.Context, agentID string) (bool, error) {
	var pending bool
	err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM agent_jobs WHERE agent_id=$1 AND state='queued' AND deadline>now())
		OR EXISTS(SELECT 1 FROM action_jobs WHERE agent_id=$1 AND state='queued' AND deadline>now())`, agentID).Scan(&pending)
	return pending, err
}

func (s *Server) agentlessRun(ctx context.Context, assetID int64, pam pamTarget, setup *agentlessSetup) {
	started := time.Now().UTC()
	kind := "run"
	if setup != nil {
		kind = "setup"
	}
	doc := map[string]any{"state": "running", "kind": kind, "started_at": started.Format(time.RFC3339Nano), "finished_at": nil, "detail": "", "output": ""}
	s.agentlessRecord(assetID, doc)
	output := []string{}
	fail := func(err error) {
		detail := "The agentless run failed"
		var failure installFailure
		if errors.As(err, &failure) {
			detail = failure.message
		} else if errors.Is(err, context.DeadlineExceeded) {
			detail = "The agentless run did not finish in time"
		} else if err != nil {
			detail = detail + ": " + err.Error()
		}
		doc["state"], doc["detail"] = "failed", detail
	}
	runCtx, cancel := context.WithTimeout(ctx, agentlessMaxRun)
	defer cancel()

	var osType string
	if pam == nil {
		var err error
		pam, osType, err = s.openPAM(runCtx, assetID)
		if err != nil {
			fail(err)
			s.finishAgentless(assetID, doc, output, setup)
			return
		}
	} else {
		var raw []byte
		if err := s.DB.QueryRowContext(runCtx, "SELECT data->>'os_type' FROM assets WHERE id=$1", assetID).Scan(&raw); err == nil {
			osType = string(raw)
		}
	}
	defer pam.Close()
	tunnel, err := pam.Tunnel(runCtx, agentlessTunnelPort, s.tunnelHandler())
	if err != nil {
		fail(err)
		s.finishAgentless(assetID, doc, output, setup)
		return
	}
	defer tunnel.Close()

	if setup != nil {
		script, stdin := agentlessSetupScript(osType, setup)
		out, err := pam.Script(runCtx, script, stdin)
		output = append(output, redact(out, setup.token))
		if err != nil {
			fail(installFailure{"Agent setup on the host failed; see the output"})
			s.finishAgentless(assetID, doc, output, setup)
			return
		}
	}
	out, err := pam.Script(runCtx, agentlessServiceScript(osType, "start"), nil)
	output = append(output, out)
	if err != nil {
		fail(installFailure{"The agent could not be started on the host; see the output"})
		s.finishAgentless(assetID, doc, output, setup)
		return
	}
	waitErr := s.agentlessWait(runCtx, assetID, started, setup != nil)
	// Stop with a fresh context, so a cancelled run still leaves the agent stopped.
	stopCtx, stopCancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
	out, stopErr := pam.Script(stopCtx, agentlessServiceScript(osType, "stop"), nil)
	stopCancel()
	output = append(output, out)
	switch {
	case waitErr != nil:
		fail(waitErr)
	case stopErr != nil:
		fail(installFailure{"The work finished but the agent could not be stopped on the host; see the output"})
	default:
		doc["state"] = "completed"
		if setup != nil {
			doc["detail"] = "Agentless setup finished and the first scan was delivered"
		} else {
			doc["detail"] = "Queued work was delivered"
		}
	}
	s.finishAgentless(assetID, doc, output, setup)
}

// agentlessWait keeps the agent running until it has enrolled (setup), the queue for
// it is empty and the settle time has passed.
func (s *Server) agentlessWait(ctx context.Context, assetID int64, started time.Time, setup bool) error {
	quietSince := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
		var agentID string
		err := s.DB.QueryRowContext(ctx, "SELECT id FROM agents WHERE asset_id=$1 AND NOT revoked", assetID).Scan(&agentID)
		if errors.Is(err, sql.ErrNoRows) {
			if time.Since(started) > agentlessEnrollLimit {
				return installFailure{"The agent did not enroll through the tunnel; see the output and the agent log on the host"}
			}
			continue
		}
		if err != nil {
			return err
		}
		pending, err := s.agentlessPending(ctx, agentID)
		if err != nil {
			return err
		}
		if setup {
			// The first start of a new agent runs a full scan; wait for that report.
			var delivered bool
			if err := s.DB.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM reports WHERE agent_id=$1 AND accepted_at>=$2)", agentID, started).Scan(&delivered); err != nil {
				return err
			}
			pending = pending || !delivered
		}
		if pending {
			quietSince = time.Time{}
			continue
		}
		if quietSince.IsZero() {
			quietSince = time.Now()
		}
		if time.Since(quietSince) >= agentlessSettle {
			return nil
		}
	}
}

func redact(text, secret string) string {
	if secret == "" {
		return text
	}
	return strings.ReplaceAll(text, secret, "[redacted]")
}

func (s *Server) finishAgentless(assetID int64, doc map[string]any, output []string, setup *agentlessSetup) {
	joined := strings.TrimSpace(strings.Join(output, "\n"))
	if setup != nil {
		joined = redact(joined, setup.token)
	}
	joined = strings.ToValidUTF8(joined, "?")
	if len(joined) > 6000 {
		joined = joined[len(joined)-6000:]
	}
	doc["output"] = joined
	doc["finished_at"] = now()
	if setup != nil && doc["state"] != "completed" {
		// An unused setup token must not outlive a failed setup.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if res, err := s.DB.ExecContext(ctx, "DELETE FROM enrollment_tokens WHERE hash=$1 AND remaining>0", digest(setup.token)); err == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				_, _ = s.DB.ExecContext(ctx, "DELETE FROM documents WHERE collection=$1 AND id=$2", agentInstallsCollection, digest(setup.token))
			}
		}
		cancel()
	}
	s.agentlessRecord(assetID, doc)
	if _, err := s.DB.ExecContext(context.Background(), "INSERT INTO audit_log(username,action,target,success,ip,detail) VALUES($1,$2,$3,$4,$5,$6)", "system", "agentless."+text(doc["kind"]), strconv.FormatInt(assetID, 10), doc["state"] == "completed", "", text(doc["detail"])); err != nil {
		slog.Error("audit event persistence failed", "action", "agentless run")
	}
}

// RunAgentless starts a run for every agentless host that has queued work.
func (s *Server) RunAgentless(ctx context.Context) {
	st := s.agentless()
	st.mu.Lock()
	st.ctx = ctx
	st.mu.Unlock()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		cycle, cancel := context.WithTimeout(ctx, 20*time.Second)
		rows, err := s.DB.QueryContext(cycle, `SELECT g.asset_id FROM agents g JOIN assets a ON a.id=g.asset_id
			WHERE NOT g.revoked AND a.data->>'connection' IN ('ssh','winrm') AND (
			EXISTS(SELECT 1 FROM agent_jobs j WHERE j.agent_id=g.id AND j.state='queued' AND j.deadline>now())
			OR EXISTS(SELECT 1 FROM action_jobs j WHERE j.agent_id=g.id AND j.state='queued' AND j.deadline>now()))`)
		if err != nil {
			cancel()
			if ctx.Err() == nil {
				slog.Error("agentless queue lookup failed")
			}
			continue
		}
		ids := []int64{}
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		cancel()
		for _, id := range ids {
			s.startAgentlessRun(id, nil, nil)
		}
	}
}

// agentlessSetupScript installs the agent stopped and not started at boot. On Linux
// the token is part of the script, which travels on standard input to sh; on Windows
// it is the next input line after the script.
func agentlessSetupScript(osType string, setup *agentlessSetup) (string, []byte) {
	flag := ""
	if osType == "windows" {
		if setup.remediation {
			flag = "--allow-remediation"
		}
		script := strings.NewReplacer("__BASE__", agentlessTunnelBase, "__BINARY__", windowsAgentBinary, "__REMEDIATION__", flag).Replace(windowsAgentlessSetup)
		return script, []byte(setup.token + "\n")
	}
	if setup.remediation {
		flag = " -allow-remediation"
	}
	return strings.NewReplacer("__BASE__", agentlessTunnelBase, "__BINARY__", linuxAgentBinary, "__REMEDIATION__", flag, "__TOKEN__", setup.token).Replace(linuxAgentlessSetup), nil
}

func agentlessServiceScript(osType, action string) string {
	if osType == "windows" {
		return strings.Replace(windowsAgentlessService, "__ACTION__", action, 1)
	}
	if action == "start" {
		return "set -eu\nsystemctl start wearden-agentless\nsystemctl is-active wearden-agentless\n"
	}
	return "set -eu\nsystemctl stop wearden-agentless\necho stopped\n"
}

// KillMode=process stops only the agent; its independent recovery helper must be
// able to finish compensating an unacknowledged change after the agent stops.
const linuxAgentlessSetup = `set -eu
base='__BASE__'
for tool in curl sha256sum systemctl install mktemp; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing required tool: $tool" >&2; exit 1; }
done
[ "$(uname -m)" = "x86_64" ] || { echo "only x86_64 is supported" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsS --noproxy '*' "$base/downloads/__BINARY__" -o "$tmp/agent"
curl -fsS --noproxy '*' "$base/downloads/SHA256SUMS" -o "$tmp/SHA256SUMS"
expected="$(grep " __BINARY__\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
actual="$(sha256sum "$tmp/agent" | cut -d' ' -f1)"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "checksum mismatch, nothing was installed" >&2; exit 1; }
systemctl stop wearden-agentless >/dev/null 2>&1 || true
install -o root -g root -m 0755 "$tmp/agent" /usr/local/sbin/wearden-agentless
install -d -m 0700 /var/lib/wearden-agentless /etc/wearden-agentless
( umask 077; printf 'WEARDEN_ENROLLMENT_TOKEN=%s\n' '__TOKEN__' > /etc/wearden-agentless/agent.env )
cat > /etc/systemd/system/wearden-agentless.service <<'UNIT'
[Unit]
Description=Wearden agent for agentless runs (started and stopped by core over SSH)

[Service]
EnvironmentFile=/etc/wearden-agentless/agent.env
ExecStart=/usr/local/sbin/wearden-agentless -daemon -core-url __BASE____REMEDIATION__ -state-dir /var/lib/wearden-agentless
KillMode=process
TimeoutStopSec=90
Restart=no
UNIT
systemctl daemon-reload
echo "Wearden agent installed for agentless runs; it is not started at boot."
`

const windowsAgentlessSetup = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$token = [Console]::In.ReadLine()
if (-not $token) { throw 'enrollment token was not received' }
$base = '__BASE__'
$name = '__BINARY__'
$installed = Join-Path $env:ProgramFiles 'WeardenAgent\agent.exe'
if (-not (Get-Service -Name WeardenAgent -ErrorAction SilentlyContinue)) {
  $dir = Join-Path $env:TEMP ('wearden-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    $exe = Join-Path $dir 'agent.exe'
    $wc = New-Object Net.WebClient
    $wc.Proxy = $null
    $wc.DownloadFile("$base/downloads/$name", $exe)
    $sums = $wc.DownloadString("$base/downloads/SHA256SUMS")
    $expected = $null
    foreach ($line in ($sums -split '\r?\n')) {
      $parts = $line.Trim() -split '\s+'
      if ($parts.Count -ge 2 -and $parts[-1] -eq $name) { $expected = $parts[0].ToLower() }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLower()
    if (-not $expected -or $expected -ne $actual) { throw 'checksum mismatch, nothing was installed' }
    & $exe service install --server $base --confirm __REMEDIATION__
    if ($LASTEXITCODE -ne 0) { throw "service install failed with exit code $LASTEXITCODE" }
  } finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
[IO.File]::WriteAllText((Join-Path $env:ProgramData 'WeardenAgent\enrollment-token.txt'), $token, [Text.Encoding]::ASCII)
& sc.exe config WeardenAgent start= demand | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'cannot set the WeardenAgent service to manual start' }
'Wearden agent installed for agentless runs; it is not started at boot.'
`

const windowsAgentlessService = `$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:ProgramFiles 'WeardenAgent\agent.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'the Wearden agent is not installed; run agentless setup first' }
$svc = Get-Service -Name WeardenAgent
if ('__ACTION__' -eq 'stop' -and $svc.Status -eq 'Stopped') { 'already stopped'; exit 0 }
if ('__ACTION__' -eq 'start' -and $svc.Status -eq 'Running') { 'already running'; exit 0 }
& $exe service __ACTION__
if ($LASTEXITCODE -ne 0) { throw "service __ACTION__ failed with exit code $LASTEXITCODE" }
"service __ACTION__ requested"
`
