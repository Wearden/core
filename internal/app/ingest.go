package app

import (
	"database/sql"
	"encoding/json"
	"github.com/Wearden/core/internal/security"
	"github.com/Wearden/proto/wire"
	"net/http"
	"time"
)

func array(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return []any{}
}
func scanDocument(id, name, bid, profile, creator string, ids []string, hosts []any) map[string]any {
	return map[string]any{"id": id, "name": name, "benchmark_id": bid, "profile_name": profile, "control_ids": ids, "status": "queued", "total_checks": len(ids) * len(hosts), "done_checks": 0, "host_count": len(hosts), "created_by": creator, "created_at": now(), "started_at": nil, "finished_at": nil, "message": nil, "hosts": hosts, "results": []any{}}
}
func (s *Server) ingestReport(w http.ResponseWriter, r *http.Request) {
	a, err := s.agentIdentity(r)
	if err != nil {
		problem(w, 401, "Invalid agent credential")
		return
	}
	var in wire.Report
	if !decode(w, r, &in) {
		return
	}
	if err = in.Validate(); err != nil {
		problem(w, 400, err.Error())
		return
	}
	if in.AgentID != a.ID || in.BenchmarkID != a.BenchmarkID || in.FinishedAt.After(time.Now().Add(5*time.Minute)) {
		problem(w, 403, "Report is outside this agent assignment")
		return
	}
	b := s.Catalog[a.BenchmarkID]
	if b == nil || len(b.Native) == 0 || in.RulesetVersion != b.Version {
		problem(w, 409, "Ruleset version is not assigned to this agent")
		return
	}
	canonical, err := json.Marshal(in)
	if err != nil {
		problem(w, 400, "Invalid report")
		return
	}
	checksum := digest(string(canonical))
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var liveID string
	if err = tx.QueryRowContext(r.Context(), "SELECT id FROM agents WHERE id=$1 AND NOT revoked AND token_hash=$2 FOR UPDATE", a.ID, digest(bearer(r))).Scan(&liveID); err != nil {
		problem(w, 401, "Agent revoked")
		return
	}
	var oldDigest string
	err = tx.QueryRowContext(r.Context(), "SELECT digest FROM reports WHERE agent_id=$1 AND report_id=$2", a.ID, in.ReportID).Scan(&oldDigest)
	if err == nil {
		if oldDigest != checksum {
			problem(w, 409, "Report ID already used for different content")
			return
		}
		writeJSON(w, 200, wire.Receipt{ReportID: in.ReportID, Accepted: true})
		return
	}
	if err != sql.ErrNoRows {
		s.databaseError(w, err)
		return
	}
	expected := map[string]bool{}
	scanID := in.ScanID
	var doc map[string]any
	jobState := ""
	if scanID != "" {
		var raw []byte
		if err = tx.QueryRowContext(r.Context(), "SELECT rule_ids,state FROM agent_jobs WHERE agent_id=$1 AND scan_id=$2", a.ID, scanID).Scan(&raw, &jobState); err != nil {
			problem(w, 403, "Scan job is not assigned to this agent")
			return
		}
		if jobState == "completed" {
			problem(w, 409, "Scan job is already complete")
			return
		}
		var ids []string
		if json.Unmarshal(raw, &ids) != nil {
			problem(w, 500, "Invalid job metadata")
			return
		}
		for _, id := range ids {
			expected[id] = true
		}
		if err = tx.QueryRowContext(r.Context(), "SELECT data FROM documents WHERE collection='scans' AND id=$1 FOR UPDATE", scanID).Scan(&raw); err != nil {
			s.databaseError(w, err)
			return
		}
		if json.Unmarshal(raw, &doc) != nil {
			problem(w, 500, "Invalid stored scan")
			return
		}
	} else {
		for id := range b.Controls {
			expected[id] = true
		}
		scanID, err = security.ID()
		if err != nil {
			problem(w, 500, "Cannot create report scan")
			return
		}
		ids := []string{}
		for id := range expected {
			ids = append(ids, id)
		}
		doc = scanDocument(scanID, "Agent scan: "+a.Hostname, a.BenchmarkID, "full", "agent:"+a.ID, ids, []any{})
		doc["created_at"] = in.StartedAt
	}
	if len(in.Findings) != len(expected) {
		problem(w, 400, "Report must account for every assigned control")
		return
	}
	for _, f := range in.Findings {
		control, exists := b.Controls[f.RuleID]
		if !exists || !expected[f.RuleID] || f.Severity != control.Severity {
			problem(w, 400, "Finding identity or severity differs from assigned ruleset")
			return
		}
	}
	hosts := array(doc["hosts"])
	hostID := int64(0)
	hostIndex := -1
	for i, h := range hosts {
		m, ok := h.(map[string]any)
		if ok && integer(m["asset_id"]) == a.AssetID {
			hostID = integer(m["id"])
			hostIndex = i
			break
		}
	}
	if in.ScanID != "" && hostIndex < 0 {
		problem(w, 403, "Agent asset is not assigned to scan")
		return
	}
	if hostID == 0 {
		hostID, err = nextID(r.Context(), tx, "host")
		if err != nil {
			s.databaseError(w, err)
			return
		}
	}
	scores := wire.Score(in.Findings)
	counts := map[string]int{wire.Pass: 0, wire.Fail: 0, wire.Error: 0, wire.NotApplicable: 0}
	for _, f := range in.Findings {
		counts[f.Status]++
	}
	host := map[string]any{"id": hostID, "asset_id": a.AssetID, "asset_name": a.Hostname, "host": a.Hostname, "os_detected": nil, "status": "completed", "passed": counts[wire.Pass], "failed": counts[wire.Fail], "errored": counts[wire.Error], "not_applicable": counts[wire.NotApplicable], "score": scores.Compliance, "weighted_score": scores.Weighted, "message": nil}
	if hostIndex >= 0 {
		old := hosts[hostIndex].(map[string]any)
		host["asset_name"] = old["asset_name"]
		host["host"] = old["host"]
		hosts[hostIndex] = host
	} else {
		hosts = append(hosts, host)
	}
	results := []any{}
	for _, row := range array(doc["results"]) {
		m, ok := row.(map[string]any)
		if ok && integer(m["host_result_id"]) != hostID {
			results = append(results, row)
		}
	}
	for _, f := range in.Findings {
		control := b.Controls[f.RuleID]
		id, err := nextID(r.Context(), tx, "finding")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		results = append(results, map[string]any{"id": id, "host_result_id": hostID, "asset_name": host["asset_name"], "control_id": f.RuleID, "title": control.Title, "category": control.Category, "severity": control.Severity, "status": f.Status, "actual": f.Evidence, "expected": control.Audit.Expected, "raw_output": f.Evidence, "duration_ms": 0, "message": nil, "checked_at": in.FinishedAt})
	}
	doc["hosts"] = hosts
	doc["results"] = results
	doc["host_count"] = len(hosts)
	doc["done_checks"] = len(results)
	if doc["started_at"] == nil {
		doc["started_at"] = in.StartedAt
	}
	complete := true
	for _, h := range hosts {
		if m, ok := h.(map[string]any); !ok || text(m["status"]) != "completed" {
			complete = false
		}
	}
	if text(doc["status"]) != "cancelled" && text(doc["status"]) != "failed" {
		doc["status"] = "running"
		if complete {
			doc["status"] = "completed"
			doc["finished_at"] = in.FinishedAt
		}
	}
	data, err := json.Marshal(doc)
	if err != nil {
		problem(w, 500, "Cannot encode stored scan")
		return
	}
	_, err = tx.ExecContext(r.Context(), "INSERT INTO documents(collection,id,data,created_at) VALUES('scans',$1,$2,$3) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data", scanID, data, doc["created_at"])
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO reports(agent_id,report_id,digest,scan_id,data) VALUES($1,$2,$3,$4,$5)", a.ID, in.ReportID, checksum, scanID, canonical)
	}
	if err == nil && in.ScanID != "" {
		_, err = tx.ExecContext(r.Context(), "UPDATE agent_jobs SET state='completed' WHERE agent_id=$1 AND scan_id=$2", a.ID, in.ScanID)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE agents SET last_seen=now() WHERE id=$1", a.ID)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `UPDATE assets SET data=data||jsonb_build_object('status','online','last_seen',now(),'last_checked',now()) WHERE id=$1`, a.AssetID)
	}
	if err == nil {
		err = s.reconcileDrift(r.Context(), tx, a.AssetID, a.Hostname, a.ID, in.FinishedAt, in.Findings)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "agent.report_accepted", scanID, true, "")
	writeJSON(w, 201, wire.Receipt{ReportID: in.ReportID, Accepted: true})
}
