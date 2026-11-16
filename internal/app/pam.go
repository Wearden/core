package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Wearden/core/internal/benchmarks"
	"github.com/Wearden/core/internal/security"
	"github.com/Wearden/proto/wire"
)

// PAM (agentless) asset management, separate from installed agents. A PAM asset has
// connection "ssh" or "winrm". Scans run the audit commands of the reviewed benchmark
// YAML over that connection; hardening captures a typed backup, runs the remediation,
// re-checks, and arms a safety net for risky controls; rollback restores the backup or
// runs the YAML rollback command. Results use the same scan and hardening records as
// agent runs (marked mode "pam"), so the result, report and rollback views apply.
const (
	pamParallelHosts  = 4
	pamAuditTimeout   = 60 * time.Second
	pamCaptureTimeout = 60 * time.Second
	pamChangeTimeout  = 300 * time.Second
	pamSafetyWindow   = 120
	pamReconnectEvery = 10 * time.Second
	pamReconnectGrace = 90 * time.Second
	pamBackupsColl    = "pam_backups"
	pamProbeInterval  = 30 * time.Second
	pamDetectLinux    = "cat /etc/os-release; echo '---'; id -u"
	pamDetectWindows  = "(Get-CimInstance Win32_OperatingSystem).Caption"
)

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

func isPAMConnection(c string) bool { return c == "ssh" || c == "winrm" }

func sshAddress(asset map[string]any) string {
	port := integer(asset["ssh_port"])
	if port == 0 {
		port = 22
	}
	return net.JoinHostPort(text(asset["host"]), strconv.FormatInt(port, 10))
}

// assetCredential loads an asset with its decrypted credential.
func (s *Server) assetCredential(ctx context.Context, assetID int64) (map[string]any, string, string, []byte, error) {
	var raw, encrypted []byte
	var username, authType string
	err := s.DB.QueryRowContext(ctx, "SELECT a.data,c.username,c.auth_type,c.encrypted FROM assets a JOIN credentials c ON c.asset_id=a.id WHERE a.id=$1", assetID).Scan(&raw, &username, &authType, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", "", nil, pamTransportError{"Asset or stored credential not found"}
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
		return nil, "", "", nil, pamTransportError{"Cannot decrypt host credential"}
	}
	return asset, username, authType, secret, nil
}

func pamMessage(err error) string {
	var te pamTransportError
	if errors.As(err, &te) {
		return te.message
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "the operation was cancelled or timed out"
	}
	return "unexpected error"
}

type pamState struct {
	mu  sync.Mutex
	ctx context.Context
}

func (s *Server) pamCtx() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pam == nil || s.pam.ctx == nil {
		return context.Background()
	}
	return s.pam.ctx
}

func (s *Server) pamRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/pam/benchmarks", s.require("viewer", s.pamBenchmarks))
	m.HandleFunc("POST /api/pam/assets/{id}/test", s.require("operator", s.pamTest))
	m.HandleFunc("POST /api/pam/scans", s.require("operator", s.pamCreateScan))
	m.HandleFunc("POST /api/pam/hardening", s.require("operator", s.pamCreateHardening))
}

// pamBenchmarks lists the benchmarks whose controls carry audit commands.
func (s *Server) pamBenchmarks(w http.ResponseWriter, r *http.Request) {
	ids := []string{}
	for id, b := range s.Catalog {
		if pamCapable(b) {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	out := []map[string]any{}
	for _, id := range ids {
		out = append(out, s.Catalog[id].Summary())
	}
	writeJSON(w, 200, out)
}

func pamCapable(b *benchmarks.Benchmark) bool {
	if b == nil || len(b.Native) != 0 || len(b.Controls) == 0 {
		return false
	}
	for _, c := range b.Controls {
		if strings.TrimSpace(c.Audit.Command) == "" {
			return false
		}
	}
	return true
}

// ---- test connection ----

func (s *Server) pamTest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HostKey        string `json:"host_key"`
		ReplaceHostKey bool   `json:"replace_host_key"`
	}
	if !decode(w, r, &in) {
		return
	}
	assetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || assetID < 1 {
		problem(w, 400, "Invalid asset id")
		return
	}
	target, err := s.pamTargetFor(r.Context(), assetID)
	if err != nil {
		var te pamTransportError
		if errors.As(err, &te) {
			problem(w, 409, te.message)
		} else {
			s.databaseError(w, err)
		}
		return
	}
	defer target.wipe()
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	key := strconv.FormatInt(assetID, 10)
	if target.Protocol == "ssh" {
		presented, keyType, err := sshProbeHostKey(ctx, target.addr, target.username)
		if err != nil {
			s.pamMarkStatus(ctx, assetID, "offline", nil, nil, nil)
			writeJSON(w, 200, map[string]any{"status": "failed", "detail": "Cannot reach an SSH server on " + target.addr})
			return
		}
		changed := target.pinned != "" && target.pinned != presented
		if (changed && !(in.ReplaceHostKey && in.HostKey == presented)) || (target.pinned == "" && in.HostKey != presented) {
			if changed {
				s.audit(r, "pam.host_key_changed", key, false, presented)
			}
			writeJSON(w, 200, map[string]any{"status": "confirm_host_key", "host_key": presented, "host_key_type": keyType, "host_key_changed": changed})
			return
		}
		target.pinned = presented
		started := time.Now()
		conn, err := target.open(ctx)
		if err != nil {
			s.audit(r, "pam.test", key, false, pamMessage(err))
			writeJSON(w, 200, map[string]any{"status": "failed", "detail": pamMessage(err)})
			return
		}
		latency := float64(time.Since(started).Milliseconds())
		defer conn.Close()
		if err := s.Store.Put(ctx, hostKeysCollection, key, map[string]any{"address": target.addr, "fingerprint": presented, "key_type": keyType, "confirmed_by": current(r).Username, "confirmed_at": now()}); err != nil {
			s.databaseError(w, err)
			return
		}
		osName, privilege, err := pamDetect(ctx, conn, target)
		if err != nil {
			s.audit(r, "pam.test", key, false, pamMessage(err))
			writeJSON(w, 200, map[string]any{"status": "failed", "detail": pamMessage(err)})
			return
		}
		s.pamMarkStatus(ctx, assetID, "online", &osName, &privilege, &latency)
		s.audit(r, "pam.test", key, true, "ssh")
		writeJSON(w, 200, map[string]any{"status": "ok", "os_detected": osName, "privilege": privilege, "latency_ms": latency, "host_key": presented})
		return
	}
	started := time.Now()
	conn, err := target.open(ctx)
	if err != nil {
		s.pamMarkStatus(ctx, assetID, "offline", nil, nil, nil)
		s.audit(r, "pam.test", key, false, pamMessage(err))
		writeJSON(w, 200, map[string]any{"status": "failed", "detail": pamMessage(err)})
		return
	}
	defer conn.Close()
	latency := float64(time.Since(started).Milliseconds())
	osName, privilege, err := pamDetect(ctx, conn, target)
	if err != nil {
		writeJSON(w, 200, map[string]any{"status": "failed", "detail": pamMessage(err)})
		return
	}
	s.pamMarkStatus(ctx, assetID, "online", &osName, &privilege, &latency)
	s.audit(r, "pam.test", key, true, "winrm")
	writeJSON(w, 200, map[string]any{"status": "ok", "os_detected": osName, "privilege": privilege, "latency_ms": latency})
}

func pamDetect(ctx context.Context, conn pamConn, t *pamTarget) (string, string, error) {
	if t.OS == "windows" {
		res, err := conn.Run(ctx, pamDetectWindows, pamAuditTimeout)
		if err != nil {
			return "", "", err
		}
		return strings.TrimSpace(res.Stdout), "administrator", nil
	}
	res, err := conn.Run(ctx, pamDetectLinux, pamAuditTimeout)
	if err != nil {
		return "", "", err
	}
	osPart, rest, _ := strings.Cut(res.Stdout, "---")
	name := ""
	for _, line := range strings.Split(osPart, "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok && k == "PRETTY_NAME" {
			name = strings.Trim(v, `"`)
		}
	}
	// Scripts run through root or sudo, so the effective id is 0 when privilege works.
	privilege := "user"
	if strings.TrimSpace(rest) == "0" {
		privilege = "root"
		if ps, ok := conn.(*pamSSH); ok && ps.prefix != "" {
			privilege = "sudo"
		}
	}
	return name, privilege, nil
}

func (s *Server) pamMarkStatus(ctx context.Context, assetID int64, status string, osName, privilege *string, latency *float64) {
	patch := map[string]any{"status": status, "last_checked": now()}
	if status == "online" {
		patch["last_seen"] = now()
	}
	if osName != nil && *osName != "" {
		patch["os_detected"] = *osName
	}
	if privilege != nil {
		patch["privilege"] = *privilege
	}
	if latency != nil {
		patch["latency_ms"] = *latency
	}
	raw, _ := json.Marshal(patch)
	if _, err := s.DB.ExecContext(ctx, "UPDATE assets SET data=data||$2::jsonb WHERE id=$1", assetID, raw); err == nil {
		_, _ = s.DB.ExecContext(ctx, "INSERT INTO host_samples(asset_id,status) VALUES($1,$2)", assetID, status)
	}
}

// RunPAM keeps PAM asset status current with a TCP check of the management port,
// like the agent heartbeat does for agent assets.
func (s *Server) RunPAM(ctx context.Context) {
	s.mu.Lock()
	if s.pam == nil {
		s.pam = &pamState{}
	}
	s.pam.ctx = ctx
	s.mu.Unlock()
	// PAM work runs inside core, so a restart ends it. Record that instead of leaving
	// runs that look active forever; a change that was in progress needs a check.
	interrupted := `UPDATE documents SET data=data||jsonb_build_object('status','failed','finished_at',$2::text,'message','Interrupted by a core restart; run a scan to check the hosts')
		WHERE collection=$1 AND data->>'mode'='pam' AND data->>'status' IN ('queued','running','rollback_queued')`
	for _, coll := range []string{"scans", "hardening", "rollbacks"} {
		if _, err := s.DB.ExecContext(ctx, interrupted, coll, now()); err != nil && ctx.Err() == nil {
			slog.Error("pam interrupted run cleanup failed")
		}
	}
	ticker := time.NewTicker(pamProbeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		cycle, cancel := context.WithTimeout(ctx, 25*time.Second)
		rows, err := s.DB.QueryContext(cycle, "SELECT id,data FROM assets WHERE data->>'connection' IN ('ssh','winrm')")
		if err != nil {
			cancel()
			continue
		}
		type probe struct {
			id   int64
			addr string
		}
		probes := []probe{}
		for rows.Next() {
			var id int64
			var raw []byte
			if rows.Scan(&id, &raw) != nil {
				continue
			}
			var asset map[string]any
			if json.Unmarshal(raw, &asset) != nil {
				continue
			}
			addr := sshAddress(asset)
			if assetConnection(asset) == "winrm" {
				port, _ := pamWinRMPort(asset)
				addr = net.JoinHostPort(text(asset["host"]), strconv.Itoa(port))
			}
			probes = append(probes, probe{id, addr})
		}
		rows.Close()
		var wg sync.WaitGroup
		for _, p := range probes {
			wg.Add(1)
			go func(p probe) {
				defer wg.Done()
				started := time.Now()
				conn, err := (&net.Dialer{Timeout: 3 * time.Second}).DialContext(cycle, "tcp", p.addr)
				if err != nil {
					s.pamMarkStatus(cycle, p.id, "offline", nil, nil, nil)
					return
				}
				conn.Close()
				latency := float64(time.Since(started).Milliseconds())
				s.pamMarkStatus(cycle, p.id, "online", nil, nil, &latency)
			}(p)
		}
		wg.Wait()
		cancel()
	}
}

// ---- shared helpers ----

func (s *Server) pamValidateAssets(ctx context.Context, ids []int64, osType string) ([]map[string]any, error) {
	if len(ids) < 1 || len(ids) > 200 {
		return nil, errors.New("select between 1 and 200 hosts")
	}
	seen := map[int64]bool{}
	out := []map[string]any{}
	for _, id := range ids {
		if seen[id] {
			return nil, errors.New("duplicate asset")
		}
		seen[id] = true
		a, err := s.asset(ctx, id)
		if err != nil {
			return nil, errors.New("asset " + strconv.FormatInt(id, 10) + " not found")
		}
		if !isPAMConnection(assetConnection(a)) {
			return nil, errors.New(text(a["name"]) + " is managed by an installed agent; use the agent pages for it")
		}
		if text(a["os_type"]) != osType {
			return nil, errors.New(text(a["name"]) + " does not match the benchmark operating system")
		}
		if a["credential_username"] == nil {
			return nil, errors.New(text(a["name"]) + " has no stored credential")
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *Server) nextFindingID(ctx context.Context) (int64, error) {
	var id int64
	err := s.DB.QueryRowContext(ctx, "SELECT nextval('finding_ids')").Scan(&id)
	return id, err
}

// pamDoc is a scan or hardening document updated by one runner. flush merges a
// cancellation recorded in the database, so the runner never overwrites it.
type pamDoc struct {
	mu         sync.Mutex
	collection string
	id         string
	doc        map[string]any
}

func (d *pamDoc) cancelled() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return text(d.doc["status"]) == "cancelled"
}

func (s *Server) pamFlush(ctx context.Context, d *pamDoc) {
	d.mu.Lock()
	defer d.mu.Unlock()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		slog.Error("pam document flush failed")
		return
	}
	defer tx.Rollback()
	var raw []byte
	if err = tx.QueryRowContext(ctx, "SELECT data FROM documents WHERE collection=$1 AND id=$2 FOR UPDATE", d.collection, d.id).Scan(&raw); err != nil {
		slog.Error("pam document flush failed")
		return
	}
	var stored map[string]any
	if json.Unmarshal(raw, &stored) == nil && text(stored["status"]) == "cancelled" && text(d.doc["status"]) != "cancelled" {
		d.doc["status"] = "cancelled"
		d.doc["finished_at"] = stored["finished_at"]
		d.doc["message"] = stored["message"]
		for _, c := range featureMaps(d.doc["changes"]) {
			if text(c["status"]) == "pending" {
				c["status"] = "cancelled"
			}
		}
		for _, h := range featureMaps(d.doc["hosts"]) {
			if text(h["status"]) == "pending" {
				h["status"] = "cancelled"
			}
		}
	}
	out, err := json.Marshal(d.doc)
	if err == nil {
		_, err = tx.ExecContext(ctx, "UPDATE documents SET data=$1 WHERE collection=$2 AND id=$3", out, d.collection, d.id)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		slog.Error("pam document flush failed")
	}
}

// ---- scans ----

func (s *Server) pamCreateScan(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name      string  `json:"name"`
		Benchmark string  `json:"benchmark_id"`
		Profile   string  `json:"profile_id"`
		AssetIDs  []int64 `json:"asset_ids"`
	}
	if !decode(w, r, &in) {
		return
	}
	b := s.Catalog[in.Benchmark]
	if !pamCapable(b) {
		problem(w, 400, "Select a benchmark with audit commands for PAM scans")
		return
	}
	if in.Profile == "" {
		in.Profile = "full"
	}
	ids, err := b.Select(in.Profile)
	if err != nil || len(ids) == 0 || len(in.Name) > 120 {
		problem(w, 400, "Invalid profile or name")
		return
	}
	assets, err := s.pamValidateAssets(r.Context(), in.AssetIDs, b.OS)
	if err != nil {
		problem(w, 409, err.Error())
		return
	}
	scanID, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create scan")
		return
	}
	hosts := []any{}
	for _, a := range assets {
		hostID, err := s.nextHostID(r.Context())
		if err != nil {
			s.databaseError(w, err)
			return
		}
		hosts = append(hosts, map[string]any{"id": hostID, "asset_id": a["id"], "asset_name": a["name"], "host": a["host"], "os_detected": a["os_detected"], "status": "pending", "passed": 0, "failed": 0, "errored": 0, "not_applicable": 0, "score": nil, "weighted_score": nil, "message": nil})
	}
	name := in.Name
	if name == "" {
		name = b.Name + " PAM scan"
	}
	doc := scanDocument(scanID, name, in.Benchmark, in.Profile, current(r).Username, ids, hosts)
	doc["mode"] = "pam"
	raw, err := json.Marshal(doc)
	if err == nil {
		_, err = s.DB.ExecContext(r.Context(), "INSERT INTO documents(collection,id,data) VALUES('scans',$1,$2)", scanID, raw)
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "pam.scan_queued", scanID, true, in.Benchmark)
	go s.pamRunScan(scanID, doc, b, ids)
	writeJSON(w, 201, doc)
}

func (s *Server) nextHostID(ctx context.Context) (int64, error) {
	var id int64
	err := s.DB.QueryRowContext(ctx, "SELECT nextval('host_result_ids')").Scan(&id)
	return id, err
}

func (s *Server) pamRunScan(scanID string, doc map[string]any, b *benchmarks.Benchmark, ids []string) {
	ctx := s.pamCtx()
	d := &pamDoc{collection: "scans", id: scanID, doc: doc}
	d.mu.Lock()
	d.doc["status"] = "running"
	d.doc["started_at"] = now()
	hosts := featureMaps(d.doc["hosts"])
	d.mu.Unlock()
	s.pamFlush(ctx, d)
	slots := make(chan struct{}, pamParallelHosts)
	var wg sync.WaitGroup
	for _, h := range hosts {
		wg.Add(1)
		go func(h map[string]any) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			s.pamScanHost(ctx, d, h, b, ids)
		}(h)
	}
	wg.Wait()
	d.mu.Lock()
	if text(d.doc["status"]) != "cancelled" {
		d.doc["status"] = "completed"
	}
	d.doc["finished_at"] = now()
	d.mu.Unlock()
	s.pamFlush(ctx, d)
}

func (s *Server) pamAddResult(ctx context.Context, d *pamDoc, host map[string]any, control benchmarks.Control, check pamCheck) {
	id, err := s.nextFindingID(ctx)
	if err != nil {
		return
	}
	row := map[string]any{"id": id, "host_result_id": host["id"], "asset_name": host["asset_name"], "control_id": control.ID, "title": control.Title, "category": control.Category, "severity": control.Severity, "status": check.Status, "actual": check.Actual, "expected": control.Audit.Expected, "raw_output": check.Raw, "duration_ms": check.Duration, "message": check.Message, "checked_at": now()}
	d.mu.Lock()
	d.doc["results"] = append(array(d.doc["results"]), row)
	d.doc["done_checks"] = integer(d.doc["done_checks"]) + 1
	d.mu.Unlock()
}

func (s *Server) pamSummarise(d *pamDoc, host map[string]any) {
	d.mu.Lock()
	defer d.mu.Unlock()
	counts := map[string]int{pamPass: 0, pamFail: 0, pamError: 0, pamNotApplicable: 0}
	findings := []wire.Finding{}
	for _, row := range featureMaps(d.doc["results"]) {
		if integer(row["host_result_id"]) != integer(host["id"]) {
			continue
		}
		counts[text(row["status"])]++
		findings = append(findings, wire.Finding{RuleID: text(row["control_id"]), Status: text(row["status"]), Severity: text(row["severity"])})
	}
	scores := wire.Score(findings)
	host["passed"], host["failed"], host["errored"], host["not_applicable"] = counts[pamPass], counts[pamFail], counts[pamError], counts[pamNotApplicable]
	host["score"], host["weighted_score"] = scores.Compliance, scores.Weighted
}

func (s *Server) pamScanHost(ctx context.Context, d *pamDoc, host map[string]any, b *benchmarks.Benchmark, ids []string) {
	finish := func(status string, message *string) {
		d.mu.Lock()
		host["status"] = status
		host["message"] = message
		d.mu.Unlock()
		s.pamSummarise(d, host)
		s.pamFlush(ctx, d)
	}
	errorRest := func(from int, message string) {
		for _, cid := range ids[from:] {
			s.pamAddResult(ctx, d, host, b.Controls[cid], pamCheck{Status: pamError, Message: pamStrPtr(message)})
		}
	}
	if d.cancelled() {
		errorRest(0, "scan cancelled before this check ran")
		finish("cancelled", nil)
		return
	}
	d.mu.Lock()
	host["status"] = "running"
	d.mu.Unlock()
	s.pamFlush(ctx, d)
	target, err := s.pamTargetFor(ctx, integer(host["asset_id"]))
	var conn pamConn
	if err == nil {
		conn, err = target.open(ctx)
		target.wipe()
	}
	if err != nil {
		msg := pamMessage(err)
		errorRest(0, msg)
		finish("unreachable", pamStrPtr(msg))
		return
	}
	defer conn.Close()
	for i, cid := range ids {
		if i%5 == 0 {
			s.pamFlush(ctx, d)
		}
		if d.cancelled() {
			errorRest(i, "scan cancelled before this check ran")
			finish("cancelled", nil)
			return
		}
		control := b.Controls[cid]
		check, err := pamRunCheck(ctx, conn, control)
		if err != nil && !errors.As(err, new(pamTransportError)) {
			errorRest(i, pamMessage(err))
			finish("unreachable", pamStrPtr(pamMessage(err)))
			return
		}
		s.pamAddResult(ctx, d, host, control, check)
	}
	finish("completed", nil)
}

// pamRunCheck runs one audit command. A transport failure on this one command is
// recorded as an error result for the control, not as a lost host.
func pamRunCheck(ctx context.Context, conn pamConn, control benchmarks.Control) (pamCheck, error) {
	started := time.Now()
	res, err := conn.Run(ctx, control.Audit.Command, pamAuditTimeout)
	if err != nil {
		if ctx.Err() != nil {
			return pamCheck{}, ctx.Err()
		}
		return pamCheck{Status: pamError, Message: pamStrPtr(pamMessage(err)), Duration: time.Since(started).Milliseconds()}, err
	}
	check := pamCheckFromResult(control, res)
	check.Duration = time.Since(started).Milliseconds()
	return check, nil
}

// ---- hardening ----

func (s *Server) pamCreateHardening(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name         string   `json:"name"`
		Benchmark    string   `json:"benchmark_id"`
		AssetIDs     []int64  `json:"asset_ids"`
		RuleIDs      []string `json:"rule_ids"`
		ConfirmRisky bool     `json:"confirm_risky"`
		ScanID       *string  `json:"scan_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	b := s.Catalog[in.Benchmark]
	if !pamCapable(b) {
		problem(w, 400, "Select a benchmark with remediation commands for PAM hardening")
		return
	}
	if len(in.RuleIDs) < 1 || len(in.RuleIDs) > 200 || len(in.Name) > 120 {
		problem(w, 400, "Select between 1 and 200 controls")
		return
	}
	seen := map[string]bool{}
	risky := false
	for _, id := range in.RuleIDs {
		c, ok := b.Controls[id]
		if !ok || seen[id] {
			problem(w, 400, "Unknown or duplicate control")
			return
		}
		if strings.TrimSpace(c.Remediation.Command) == "" || len(c.Remediation.Backup) == 0 {
			problem(w, 409, id+" has no remediation with a backup")
			return
		}
		seen[id] = true
		risky = risky || c.Risky
	}
	if risky && !in.ConfirmRisky {
		problem(w, 409, "Risk confirmation is required for the selected risky controls")
		return
	}
	assets, err := s.pamValidateAssets(r.Context(), in.AssetIDs, b.OS)
	if err != nil {
		problem(w, 409, err.Error())
		return
	}
	id, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create hardening run")
		return
	}
	ordered := pamOrder(in.RuleIDs, b.Controls)
	changes := []any{}
	for _, a := range assets {
		for _, cid := range ordered {
			changeID, err := s.nextFindingID(r.Context())
			if err != nil {
				s.databaseError(w, err)
				return
			}
			c := b.Controls[cid]
			changes = append(changes, map[string]any{"id": changeID, "asset_id": a["id"], "asset_name": a["name"], "host": a["host"], "control_id": cid, "severity": c.Severity, "risky": c.Risky, "seq": len(changes) + 1, "status": "pending", "before_status": nil, "before_value": nil, "after_status": nil, "after_value": nil, "rollback_status": nil, "rollback_value": nil, "safety_unit": nil, "message": nil, "remediation_output": nil, "rollback_output": nil, "backups": pamDescribeBackups(c.Remediation.Backup), "updated_at": now()})
		}
	}
	name := in.Name
	if name == "" {
		name = "PAM hardening " + b.Name
	}
	doc := map[string]any{"id": id, "mode": "pam", "name": name, "benchmark_id": in.Benchmark, "scan_id": in.ScanID, "status": "queued", "total_changes": len(changes), "done_changes": 0, "confirm_risky": in.ConfirmRisky, "host_count": len(assets), "applied_count": 0, "created_by": current(r).Username, "created_at": now(), "started_at": nil, "finished_at": nil, "message": nil, "changes": changes}
	raw, err := json.Marshal(doc)
	if err == nil {
		_, err = s.DB.ExecContext(r.Context(), "INSERT INTO documents(collection,id,data) VALUES('hardening',$1,$2)", id, raw)
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "pam.hardening_queued", id, true, in.Benchmark)
	go s.pamRunHardening(id, doc, b)
	writeJSON(w, 201, doc)
}

func (s *Server) pamRunHardening(runID string, doc map[string]any, b *benchmarks.Benchmark) {
	ctx := s.pamCtx()
	d := &pamDoc{collection: "hardening", id: runID, doc: doc}
	d.mu.Lock()
	d.doc["status"] = "running"
	d.doc["started_at"] = now()
	byAsset := map[int64][]map[string]any{}
	order := []int64{}
	for _, c := range featureMaps(d.doc["changes"]) {
		aid := integer(c["asset_id"])
		if _, ok := byAsset[aid]; !ok {
			order = append(order, aid)
		}
		byAsset[aid] = append(byAsset[aid], c)
	}
	d.mu.Unlock()
	s.pamFlush(ctx, d)
	slots := make(chan struct{}, pamParallelHosts)
	var wg sync.WaitGroup
	for _, aid := range order {
		wg.Add(1)
		go func(aid int64, changes []map[string]any) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			s.pamHardenHost(ctx, d, runID, aid, changes, b, text(doc["confirm_risky"]) == "true" || doc["confirm_risky"] == true)
		}(aid, byAsset[aid])
	}
	wg.Wait()
	d.mu.Lock()
	applied := 0
	failed := 0
	for _, c := range featureMaps(d.doc["changes"]) {
		switch text(c["status"]) {
		case "applied":
			applied++
		case "failed", "lockout_unresolved":
			failed++
		}
	}
	d.doc["applied_count"] = applied
	if text(d.doc["status"]) != "cancelled" {
		d.doc["status"] = "completed"
		if failed > 0 && applied == 0 {
			d.doc["status"] = "failed"
		}
	}
	d.doc["finished_at"] = now()
	d.mu.Unlock()
	s.pamFlush(ctx, d)
}

func (s *Server) pamSetChange(ctx context.Context, d *pamDoc, c map[string]any, fields map[string]any, done bool) {
	d.mu.Lock()
	for k, v := range fields {
		c[k] = v
	}
	c["updated_at"] = now()
	if done {
		d.doc["done_changes"] = integer(d.doc["done_changes"]) + 1
	}
	d.mu.Unlock()
	s.pamFlush(ctx, d)
}

func (s *Server) pamHardenHost(ctx context.Context, d *pamDoc, runID string, assetID int64, changes []map[string]any, b *benchmarks.Benchmark, confirm bool) {
	target, err := s.pamTargetFor(ctx, assetID)
	if err != nil {
		for _, c := range changes {
			s.pamSetChange(ctx, d, c, map[string]any{"status": "failed", "message": "host unreachable: " + pamMessage(err)}, true)
		}
		return
	}
	defer target.wipe()
	conn, err := target.open(ctx)
	if err != nil {
		for _, c := range changes {
			s.pamSetChange(ctx, d, c, map[string]any{"status": "failed", "message": "host unreachable: " + pamMessage(err)}, true)
		}
		return
	}
	defer func() {
		if conn != nil {
			conn.Close()
		}
	}()
	for _, c := range changes {
		if d.cancelled() {
			s.pamSetChange(ctx, d, c, map[string]any{"status": "cancelled", "message": "run cancelled before this change"}, true)
			continue
		}
		if conn == nil {
			if conn, err = target.open(ctx); err != nil {
				s.pamSetChange(ctx, d, c, map[string]any{"status": "failed", "message": "host unreachable: " + pamMessage(err)}, true)
				conn = nil
				continue
			}
		}
		conn = s.pamApplyChange(ctx, d, runID, target, conn, c, b.Controls[text(c["control_id"])], confirm)
	}
}

// pamApplyChange applies one change and returns the connection to keep using (a new
// one after a risky change, or nil if the host was lost).
func (s *Server) pamApplyChange(ctx context.Context, d *pamDoc, runID string, target *pamTarget, conn pamConn, c map[string]any, control benchmarks.Control, confirm bool) pamConn {
	changeID := integer(c["id"])
	s.pamSetChange(ctx, d, c, map[string]any{"status": "applying"}, false)
	before, err := pamRunCheck(ctx, conn, control)
	if err != nil && !errors.As(err, new(pamTransportError)) {
		s.pamSetChange(ctx, d, c, map[string]any{"status": "failed", "message": "connection lost before the change; nothing was changed"}, true)
		conn.Close()
		return nil
	}
	fields := map[string]any{"before_status": before.Status, "before_value": before.Actual}
	switch {
	case before.Status == pamPass:
		fields["status"], fields["message"] = "skipped", "already compliant"
	case before.Status == pamNotApplicable:
		fields["status"], fields["message"] = "skipped", "not applicable on this system"
	case before.Status == pamError:
		fields["status"], fields["message"] = "failed", "could not check the control before changing it: "+strOr(before.Message)
	case control.Risky && !confirm:
		fields["status"], fields["message"] = "skipped", "risky control: the run was not confirmed"
	}
	if fields["status"] != nil {
		s.pamSetChange(ctx, d, c, fields, true)
		return conn
	}
	if control.Rollback.Strategy == "command" {
		if _, err := pamSubstituteBefore(strOr(control.Rollback.Command), before.Actual); err != nil {
			fields["status"], fields["message"] = "failed", err.Error()
			s.pamSetChange(ctx, d, c, fields, true)
			return conn
		}
	}
	captured, err := conn.Run(ctx, pamCaptureScript(target.OS, control.Remediation.Backup), pamCaptureTimeout)
	if err != nil {
		fields["status"], fields["message"] = "failed", "could not capture the backup ("+pamMessage(err)+"), so the change was not applied"
		s.pamSetChange(ctx, d, c, fields, true)
		return conn
	}
	var entries []pamEntry
	var warnings []string
	if target.OS == "linux" {
		entries, warnings = pamParseLinuxCapture(captured.Stdout)
	} else {
		entries = pamParseWindowsCapture(captured.Stdout)
	}
	if len(entries) == 0 {
		fields["status"], fields["message"] = "failed", "could not capture the backup, so the change was not applied"
		s.pamSetChange(ctx, d, c, fields, true)
		return conn
	}
	// The backup is kept server side only; the run document shows what was captured, not the content.
	backupKey := runID + ":" + strconv.FormatInt(changeID, 10)
	if err := s.Store.Put(ctx, pamBackupsColl, backupKey, map[string]any{"os": target.OS, "asset_id": target.AssetID, "control_id": control.ID, "entries": entries, "captured_at": now()}); err != nil {
		fields["status"], fields["message"] = "failed", "could not store the backup, so the change was not applied"
		s.pamSetChange(ctx, d, c, fields, true)
		return conn
	}
	if len(warnings) > 0 {
		fields["message"] = strings.Join(warnings, "; ")
	}
	restore := pamRestoreScript(target.OS, entries)
	if control.Risky {
		armed, err := conn.Run(ctx, pamArmScript(target.OS, changeID, pamSafetyWindow, restore), pamCaptureTimeout)
		if err != nil || armed.ExitCode != 0 || !strings.Contains(armed.Stdout, "ARMED") {
			fields["status"], fields["message"] = "failed", "could not arm the safety net, so the change was not applied"
			s.pamSetChange(ctx, d, c, fields, true)
			return conn
		}
		fields["safety_unit"] = "wearden-pam-revert-" + strconv.FormatInt(changeID, 10)
	}
	s.pamSetChange(ctx, d, c, fields, false)

	remediation, err := conn.Run(ctx, control.Remediation.Command, pamChangeTimeout)
	output := remediation.Stdout
	if remediation.Stderr != "" {
		output += "\n--- stderr ---\n" + remediation.Stderr
	}
	if len(output) > 4000 {
		output = output[:4000]
	}
	if err == nil && remediation.ExitCode != 0 {
		_, _ = conn.Run(ctx, restore, pamChangeTimeout)
		if control.Risky {
			_, _ = conn.Run(ctx, pamDisarmScript(target.OS, changeID), pamCaptureTimeout)
		}
		s.pamSetChange(ctx, d, c, map[string]any{"status": "failed", "remediation_output": output, "message": "the remediation reported an error; the backup was restored"}, true)
		return conn
	}
	if err != nil && !control.Risky {
		s.pamSetChange(ctx, d, c, map[string]any{"status": "failed", "remediation_output": output, "message": "connection lost during the change; the host state is unknown. Run a check."}, true)
		conn.Close()
		return nil
	}
	if control.Risky {
		// Prove the host is still reachable with a fresh sign-in before disarming.
		conn.Close()
		fresh := s.pamReconnect(ctx, target)
		if fresh == nil {
			s.pamSetChange(ctx, d, c, map[string]any{"status": "lockout_unresolved", "remediation_output": output, "message": "host unreachable after this change; the safety net should have reverted it. Check the host."}, true)
			return nil
		}
		state, err := fresh.Run(ctx, pamDisarmScript(target.OS, changeID), pamCaptureTimeout)
		switch {
		case err == nil && strings.Contains(state.Stdout, "ALREADY_FIRED"):
			after, _ := pamRunCheck(ctx, fresh, control)
			s.pamSetChange(ctx, d, c, map[string]any{"status": "auto_rolled_back", "remediation_output": output, "after_status": after.Status, "after_value": after.Actual, "message": "connection was lost after this change; the safety net reverted it"}, true)
			return fresh
		case err != nil || !strings.Contains(state.Stdout, "DISARMED"):
			s.pamSetChange(ctx, d, c, map[string]any{"status": "lockout_unresolved", "remediation_output": output, "message": "could not confirm the safety net state; check the host"}, true)
			return fresh
		}
		conn = fresh
		fields["message"] = "confirmed: host reachable after the change; safety net disarmed"
	}
	after, err := pamRunCheck(ctx, conn, control)
	result := map[string]any{"status": "applied", "remediation_output": output, "after_status": after.Status, "after_value": after.Actual}
	if msg, ok := fields["message"]; ok {
		result["message"] = msg
	}
	if after.Status != pamPass && result["message"] == nil {
		result["message"] = "remediation ran, but the check still does not pass"
	}
	s.pamSetChange(ctx, d, c, result, true)
	if err != nil && !errors.As(err, new(pamTransportError)) {
		conn.Close()
		return nil
	}
	return conn
}

func (s *Server) pamReconnect(ctx context.Context, target *pamTarget) pamConn {
	deadline := time.Now().Add(time.Duration(pamSafetyWindow)*time.Second + pamReconnectGrace)
	for {
		conn, err := target.open(ctx)
		if err == nil {
			return conn
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(pamReconnectEvery):
		}
	}
}

// ---- rollback ----

// pamRollback handles a rollback request for a PAM run inside the open transaction.
func (s *Server) pamRollback(w http.ResponseWriter, r *http.Request, tx *sql.Tx, doc map[string]any, ids []int64, name *string) {
	if st := text(doc["status"]); st == "queued" || st == "running" || st == "rollback_queued" {
		problem(w, 409, "Wait for the run to finish before rollback")
		return
	}
	selected := map[int64]bool{}
	for _, id := range ids {
		selected[id] = true
	}
	found := 0
	picked := []int64{}
	for _, change := range featureMaps(doc["changes"]) {
		cid := integer(change["id"])
		if len(selected) > 0 && !selected[cid] {
			continue
		}
		if text(change["status"]) != "applied" || text(change["rollback_status"]) == "reverted" {
			if len(selected) > 0 {
				problem(w, 409, "Selected change was not applied or is already reverted")
				return
			}
			continue
		}
		change["rollback_status"] = "pending"
		picked = append(picked, cid)
		found++
	}
	if found == 0 || (len(selected) > 0 && found != len(selected)) {
		problem(w, 409, "No matching applied changes")
		return
	}
	groupID, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create rollback")
		return
	}
	label := "Rollback " + text(doc["name"])
	if name != nil && *name != "" {
		label = *name
	}
	rollback := map[string]any{"id": groupID, "mode": "pam", "run_id": doc["id"], "run_name": doc["name"], "name": label, "status": "queued", "total": found, "reverted": 0, "failed": 0, "created_by": current(r).Username, "created_at": now(), "started_at": nil, "finished_at": nil, "message": nil, "legacy": false}
	doc["status"] = "rollback_queued"
	raw, err := json.Marshal(doc)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE documents SET data=$1 WHERE collection='hardening' AND id=$2", raw, doc["id"])
	}
	rraw, e := json.Marshal(rollback)
	if err == nil {
		err = e
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO documents(collection,id,data) VALUES('rollbacks',$1,$2)", groupID, rraw)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "pam.rollback_queued", groupID, true, "")
	go s.pamRunRollback(text(doc["id"]), groupID, picked)
	writeJSON(w, 200, doc)
}

func (s *Server) pamRunRollback(runID, groupID string, picked []int64) {
	ctx := s.pamCtx()
	stored, err := s.Store.Get(ctx, "hardening", runID)
	if err != nil {
		return
	}
	b := s.Catalog[text(stored["benchmark_id"])]
	d := &pamDoc{collection: "hardening", id: runID, doc: stored}
	rb := &pamDoc{collection: "rollbacks", id: groupID}
	if rb.doc, err = s.Store.Get(ctx, "rollbacks", groupID); err != nil {
		return
	}
	rb.doc["status"], rb.doc["started_at"] = "running", now()
	s.pamFlush(ctx, rb)
	want := map[int64]bool{}
	for _, id := range picked {
		want[id] = true
	}
	byAsset := map[int64][]map[string]any{}
	for _, c := range featureMaps(d.doc["changes"]) {
		if want[integer(c["id"])] {
			byAsset[integer(c["asset_id"])] = append(byAsset[integer(c["asset_id"])], c)
		}
	}
	var wg sync.WaitGroup
	slots := make(chan struct{}, pamParallelHosts)
	for aid, changes := range byAsset {
		// Undo in reverse order of application.
		sort.SliceStable(changes, func(i, j int) bool { return integer(changes[i]["seq"]) > integer(changes[j]["seq"]) })
		wg.Add(1)
		go func(aid int64, changes []map[string]any) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			s.pamRollbackHost(ctx, d, rb, runID, aid, changes, b)
		}(aid, changes)
	}
	wg.Wait()
	d.mu.Lock()
	rb.mu.Lock()
	failed := integer(rb.doc["failed"])
	rb.doc["status"], rb.doc["finished_at"] = "completed", now()
	d.doc["status"] = "rolled_back"
	if failed > 0 {
		rb.doc["status"] = "failed"
		d.doc["status"] = "rollback_failed"
	}
	rb.mu.Unlock()
	d.mu.Unlock()
	s.pamFlush(ctx, d)
	s.pamFlush(ctx, rb)
}

func (s *Server) pamRollbackHost(ctx context.Context, d, rb *pamDoc, runID string, assetID int64, changes []map[string]any, b *benchmarks.Benchmark) {
	count := func(ok bool) {
		rb.mu.Lock()
		if ok {
			rb.doc["reverted"] = integer(rb.doc["reverted"]) + 1
		} else {
			rb.doc["failed"] = integer(rb.doc["failed"]) + 1
		}
		rb.mu.Unlock()
		s.pamFlush(ctx, rb)
	}
	fail := func(c map[string]any, msg string) {
		s.pamSetChange(ctx, d, c, map[string]any{"rollback_status": "failed", "rollback_output": msg}, false)
		count(false)
	}
	target, err := s.pamTargetFor(ctx, assetID)
	var conn pamConn
	if err == nil {
		defer target.wipe()
		conn, err = target.open(ctx)
	}
	if err != nil {
		for _, c := range changes {
			fail(c, "host unreachable: "+pamMessage(err))
		}
		return
	}
	defer conn.Close()
	for _, c := range changes {
		var control *benchmarks.Control
		if b != nil {
			if ctl, ok := b.Controls[text(c["control_id"])]; ok {
				control = &ctl
			}
		}
		var script string
		if control != nil && control.Rollback.Strategy == "command" {
			before, _ := c["before_value"].(string)
			script, err = pamSubstituteBefore(strOr(control.Rollback.Command), &before)
			if err != nil {
				fail(c, err.Error())
				continue
			}
		} else {
			backup, err := s.Store.Get(ctx, pamBackupsColl, runID+":"+strconv.FormatInt(integer(c["id"]), 10))
			if err != nil {
				fail(c, "no backup was recorded for this change")
				continue
			}
			entries := []pamEntry{}
			for _, e := range featureMaps(backup["entries"]) {
				entries = append(entries, pamEntry(e))
			}
			if len(entries) == 0 {
				fail(c, "no backup was recorded for this change")
				continue
			}
			script = pamRestoreScript(text(backup["os"]), entries)
		}
		res, err := conn.Run(ctx, script, pamChangeTimeout)
		output := res.Stdout
		if res.Stderr != "" {
			output += "\n--- stderr ---\n" + res.Stderr
		}
		if len(output) > 4000 {
			output = output[:4000]
		}
		if err != nil || res.ExitCode != 0 {
			msg := "the restore reported an error; check the host and the output"
			if err != nil {
				msg = "connection lost during the restore: " + pamMessage(err)
			}
			s.pamSetChange(ctx, d, c, map[string]any{"rollback_status": "failed", "rollback_output": output, "message": msg}, false)
			count(false)
			if err != nil && !errors.As(err, new(pamTransportError)) {
				return
			}
			continue
		}
		fields := map[string]any{"rollback_status": "reverted", "rollback_output": output}
		if control == nil {
			fields["message"] = "restored from the backup; the control is no longer in the benchmark, so it was not re-checked"
		} else {
			check, _ := pamRunCheck(ctx, conn, *control)
			fields["rollback_value"] = check.Actual
			if before := text(c["before_status"]); before != "" && check.Status != before {
				fields["message"] = "reverted, but the check now reports " + check.Status
			}
		}
		s.pamSetChange(ctx, d, c, fields, false)
		count(true)
	}
}
