package app

import (
	"context"

	"encoding/json"
	"errors"
	"net/http"

	"github.com/Wearden/core/internal/security"
	"github.com/Wearden/proto/wire"
	"time"
)

type hardeningInput struct {
	Name         string   `json:"name"`
	Benchmark    string   `json:"benchmark_id"`
	RuleIDs      []string `json:"control_ids"`
	AssetIDs     []int64  `json:"asset_ids"`
	ScanID       *string  `json:"scan_id"`
	ConfirmRisky bool     `json:"confirm_risky"`
}

func (s *Server) hardeningRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /api/hardening/plan", s.require("operator", s.hardeningPlan))
	m.HandleFunc("POST /api/hardening/runs", s.require("operator", s.createHardening))
	m.HandleFunc("GET /api/hardening/runs", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		docs, err := s.Store.List(r.Context(), "hardening")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		for _, d := range docs {
			delete(d, "changes")
		}
		writeJSON(w, 200, docs)
	}))
	m.HandleFunc("GET /api/hardening/runs/{id}", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		doc, err := s.Store.Get(r.Context(), "hardening", r.PathValue("id"))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, doc)
	}))
	m.HandleFunc("POST /api/hardening/runs/{id}/cancel", s.require("operator", s.cancelHardening))
	m.HandleFunc("POST /api/hardening/runs/{id}/rollback", s.require("operator", s.rollbackHardening))
	m.HandleFunc("GET /api/hardening/rollbacks", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		docs, err := s.Store.List(r.Context(), "rollbacks")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, docs)
	}))
	m.HandleFunc("GET /api/agent/v1/tasks", s.nextActionTask)
	m.HandleFunc("POST /api/agent/v1/tasks/{id}/results", s.actionResult)
}
func (s *Server) validateHardening(ctx context.Context, in hardeningInput) ([]map[string]any, error) {
	b := s.Catalog[in.Benchmark]
	if b == nil || len(in.AssetIDs) < 1 || len(in.AssetIDs) > 200 || len(in.RuleIDs) < 1 || len(in.RuleIDs) > 200 || len(in.Name) > 120 {
		return nil, errors.New("invalid benchmark, host or control selection")
	}
	seen := map[string]bool{}
	for _, id := range in.RuleIDs {
		if _, ok := b.Controls[id]; !ok || seen[id] {
			return nil, errors.New("unknown or duplicate control")
		}
		seen[id] = true
	}
	assets := []map[string]any{}
	seenAssets := map[int64]bool{}
	for _, id := range in.AssetIDs {
		if seenAssets[id] {
			return nil, errors.New("duplicate asset")
		}
		seenAssets[id] = true
		var agentID, native, osName string
		if s.DB.QueryRowContext(ctx, "SELECT id,benchmark_id,os FROM agents WHERE asset_id=$1 AND NOT revoked", id).Scan(&agentID, &native, &osName) != nil || osName != b.OS || (native != in.Benchmark && originalBenchmark(native) != in.Benchmark) {
			return nil, errors.New("selected asset is not enrolled for this benchmark")
		}
		nb := s.Catalog[native]
		if nb == nil {
			return nil, errors.New("native assignment unavailable")
		}
		for _, cid := range in.RuleIDs {
			if _, ok := nb.Controls[cid]; !ok {
				return nil, errors.New("control is not assigned to agent")
			}
		}
		a, err := s.asset(ctx, id)
		if err != nil {
			return nil, err
		}
		a["agent_id"] = agentID
		a["native_benchmark"] = native
		assets = append(assets, a)
	}
	if in.ScanID != nil {
		doc, err := s.Store.Get(ctx, "scans", *in.ScanID)
		if err != nil || text(doc["benchmark_id"]) != in.Benchmark {
			return nil, errors.New("scan reference does not match benchmark")
		}
	}
	return assets, nil
}
func (s *Server) hardeningPlan(w http.ResponseWriter, r *http.Request) {
	var in hardeningInput
	if !decode(w, r, &in) {
		return
	}
	assets, err := s.validateHardening(r.Context(), in)
	if err != nil {
		problem(w, 409, err.Error())
		return
	}
	b := s.Catalog[in.Benchmark]
	controls := []any{}
	warnings := []string{"Only agent-compiled native actions can run. The host agent must explicitly enable remediation. YAML commands are never executed."}
	for _, id := range in.RuleIDs {
		c := b.Controls[id]
		if !actionSupported(b.OS, id) {
			warnings = append(warnings, "Manual remediation required for "+id)
		}
		if actionRisky(b.OS, id, c.Risky) {
			warnings = append(warnings, "Risk confirmation required for "+id)
		}
		controls = append(controls, map[string]any{"id": id, "title": c.Title, "severity": c.Severity, "risky": actionRisky(b.OS, id, c.Risky), "reboot_required": c.RebootRequired, "commands": "Native agent action for " + id, "backups": []string{"Local private agent backup"}, "rollback": "restore_backup", "rollback_command": nil})
	}
	hosts := []any{}
	for _, a := range assets {
		before := map[string]any{}
		for _, id := range in.RuleIDs {
			before[id] = nil
		}
		if in.ScanID != nil {
			doc, e := s.Store.Get(r.Context(), "scans", *in.ScanID)
			if e == nil {
				hostIDs := map[int64]bool{}
				for _, h := range featureMaps(doc["hosts"]) {
					if integer(h["asset_id"]) == integer(a["id"]) {
						hostIDs[integer(h["id"])] = true
					}
				}
				for _, row := range featureMaps(doc["results"]) {
					cid := text(row["control_id"])
					if _, selected := before[cid]; selected && hostIDs[integer(row["host_result_id"])] {
						before[cid] = map[string]any{"status": row["status"], "actual": row["actual"]}
					}
				}
			}
		}
		hosts = append(hosts, map[string]any{"asset_id": a["id"], "asset_name": a["name"], "before": before})
	}
	writeJSON(w, 200, map[string]any{"controls": controls, "hosts": hosts, "warnings": warnings})
}
func (s *Server) createHardening(w http.ResponseWriter, r *http.Request) {
	var in hardeningInput
	if !decode(w, r, &in) {
		return
	}
	assets, err := s.validateHardening(r.Context(), in)
	if err != nil {
		problem(w, 409, err.Error())
		return
	}
	b := s.Catalog[in.Benchmark]
	for _, cid := range in.RuleIDs {
		if !actionSupported(b.OS, cid) {
			problem(w, 409, "Native remediation is not implemented for "+cid+"; use a supported subset or remediate manually")
			return
		}
	}
	for _, cid := range in.RuleIDs {
		if actionRisky(b.OS, cid, b.Controls[cid].Risky) && !in.ConfirmRisky {
			problem(w, 409, "Risk confirmation is required")
			return
		}
	}
	id, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create hardening run")
		return
	}
	name := in.Name
	if name == "" {
		name = "Hardening " + b.Name
	}
	doc := map[string]any{"id": id, "name": name, "benchmark_id": in.Benchmark, "scan_id": in.ScanID, "status": "queued", "total_changes": len(assets) * len(in.RuleIDs), "done_changes": 0, "confirm_risky": in.ConfirmRisky, "host_count": len(assets), "applied_count": 0, "created_by": current(r).Username, "created_at": now(), "started_at": nil, "finished_at": nil, "message": nil, "changes": []any{}}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	changes := []any{}
	for _, a := range assets {
		var live string
		if tx.QueryRowContext(r.Context(), "SELECT id FROM agents WHERE id=$1 AND NOT revoked FOR UPDATE", a["agent_id"]).Scan(&live) != nil {
			problem(w, 409, "Agent was revoked")
			return
		}
		for _, cid := range in.RuleIDs {
			changeID, err := nextID(r.Context(), tx, "finding")
			if err != nil {
				s.databaseError(w, err)
				return
			}
			c := b.Controls[cid]
			changes = append(changes, map[string]any{"id": changeID, "asset_id": a["id"], "asset_name": a["name"], "host": a["host"], "control_id": cid, "severity": c.Severity, "risky": actionRisky(b.OS, cid, c.Risky), "seq": len(changes) + 1, "status": "pending", "before_status": nil, "before_value": nil, "after_status": nil, "after_value": nil, "rollback_status": nil, "rollback_value": nil, "safety_unit": nil, "message": nil, "remediation_output": nil, "rollback_output": nil, "backups": []string{}, "updated_at": now()})
		}
		taskID, err := security.ID()
		if err != nil {
			problem(w, 500, "Cannot create action task")
			return
		}
		task := wire.Task{Version: wire.Version, ID: taskID, RunID: id, Action: "apply", RuleIDs: in.RuleIDs, ExpiresAt: time.Now().UTC().Add(time.Hour), Confirmed: true, SafetyWindowSeconds: 120}
		raw, err := json.Marshal(task)
		if err != nil {
			problem(w, 500, "Cannot encode task")
			return
		}
		_, err = tx.ExecContext(r.Context(), "INSERT INTO action_jobs(id,agent_id,run_id,action,task,deadline) VALUES($1,$2,$3,'apply',$4,$5)", taskID, a["agent_id"], id, raw, task.ExpiresAt)
		if err != nil {
			s.databaseError(w, err)
			return
		}
	}
	doc["changes"] = changes
	raw, err := json.Marshal(doc)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO documents(collection,id,data) VALUES('hardening',$1,$2)", id, raw)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "hardening.queued", id, true, "")
	writeJSON(w, 201, doc)
}
func (s *Server) cancelHardening(w http.ResponseWriter, r *http.Request) {
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var raw []byte
	if err = tx.QueryRowContext(r.Context(), "SELECT data FROM documents WHERE collection='hardening' AND id=$1 FOR UPDATE", r.PathValue("id")).Scan(&raw); err != nil {
		s.databaseError(w, err)
		return
	}
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		problem(w, 500, "Invalid stored run")
		return
	}
	if text(doc["status"]) == "completed" || text(doc["status"]) == "rolled_back" {
		problem(w, 409, "Run is already complete")
		return
	}
	doc["status"] = "cancelled"
	doc["finished_at"] = now()
	doc["message"] = "Queued tasks cancelled. An agent may already be applying a previously fetched task; its result remains auditable."
	for _, c := range featureMaps(doc["changes"]) {
		if text(c["status"]) == "pending" {
			c["status"] = "cancelled"
		}
	}
	raw, err = json.Marshal(doc)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE documents SET data=$1 WHERE collection='hardening' AND id=$2", raw, r.PathValue("id"))
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE action_jobs SET state='cancelled' WHERE run_id=$1 AND state='queued'", r.PathValue("id"))
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "hardening.cancelled", r.PathValue("id"), true, "")
	writeJSON(w, 200, doc)
}
