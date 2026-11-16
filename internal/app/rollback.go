package app

import (
	"encoding/json"
	"github.com/Wearden/core/internal/security"
	"github.com/Wearden/proto/wire"
	"net/http"
	"time"
)

func (s *Server) rollbackHardening(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs  []int64 `json:"change_ids"`
		Name *string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	if (in.IDs != nil && len(in.IDs) == 0) || len(in.IDs) > 40000 || (in.Name != nil && len(*in.Name) > 120) {
		problem(w, 400, "Invalid rollback selection")
		return
	}
	for _, id := range in.IDs {
		if id <= 0 {
			problem(w, 400, "Invalid rollback change ID")
			return
		}
	}
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
	// PAM runs are rolled back by core over the asset's connection, not by an agent.
	if text(doc["mode"]) == "pam" {
		for i, id := range in.IDs {
			for _, other := range in.IDs[:i] {
				if other == id {
					problem(w, 400, "Duplicate change ID")
					return
				}
			}
		}
		s.pamRollback(w, r, tx, doc, in.IDs, in.Name)
		return
	}
	var active int
	if err = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM action_jobs WHERE run_id=$1 AND state='queued'", r.PathValue("id")).Scan(&active); err != nil {
		s.databaseError(w, err)
		return
	}
	if active > 0 {
		problem(w, 409, "Wait for active tasks to finish or expire before rollback")
		return
	}
	selected := map[int64]bool{}
	for _, id := range in.IDs {
		if selected[id] {
			problem(w, 400, "Duplicate change ID")
			return
		}
		selected[id] = true
	}
	byAsset := map[int64][]string{}
	found := 0
	for _, change := range featureMaps(doc["changes"]) {
		if len(selected) > 0 && !selected[integer(change["id"])] {
			continue
		}
		if text(change["status"]) != "applied" || len(array(change["backups"])) == 0 || text(change["rollback_status"]) == "reverted" {
			if len(selected) > 0 {
				problem(w, 409, "Selected change has no restorable agent backup")
				return
			}
			continue
		}
		aid := integer(change["asset_id"])
		byAsset[aid] = append(byAsset[aid], text(change["control_id"]))
		found++
		change["rollback_status"] = "pending"
	}
	if found == 0 || (len(selected) > 0 && found != len(selected)) {
		problem(w, 409, "No matching restorable changes")
		return
	}
	groupID, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create rollback")
		return
	}
	name := "Rollback " + text(doc["name"])
	if in.Name != nil && *in.Name != "" {
		name = *in.Name
	}
	rollback := map[string]any{"id": groupID, "run_id": doc["id"], "run_name": doc["name"], "name": name, "status": "queued", "total": found, "reverted": 0, "failed": 0, "created_by": current(r).Username, "created_at": now(), "started_at": nil, "finished_at": nil, "message": nil, "legacy": false}
	for aid, ids := range byAsset {
		var agentID string
		if tx.QueryRowContext(r.Context(), "SELECT id FROM agents WHERE asset_id=$1 AND NOT revoked FOR UPDATE", aid).Scan(&agentID) != nil {
			problem(w, 409, "Rollback agent is unavailable or revoked")
			return
		}
		taskID, err := security.ID()
		if err != nil {
			problem(w, 500, "Cannot create rollback task")
			return
		}
		task := wire.Task{Version: wire.Version, ID: taskID, RunID: text(doc["id"]), Action: "rollback", RuleIDs: ids, ExpiresAt: time.Now().UTC().Add(time.Hour), Confirmed: true, SafetyWindowSeconds: 120}
		taskRaw, err := json.Marshal(task)
		if err != nil {
			problem(w, 500, "Cannot encode rollback task")
			return
		}
		if _, err = tx.ExecContext(r.Context(), "INSERT INTO action_jobs(id,agent_id,run_id,action,group_id,task,deadline) VALUES($1,$2,$3,'rollback',$4,$5,$6)", taskID, agentID, doc["id"], groupID, taskRaw, task.ExpiresAt); err != nil {
			s.databaseError(w, err)
			return
		}
	}
	doc["status"] = "rollback_queued"
	raw, err = json.Marshal(doc)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE documents SET data=$1 WHERE collection='hardening' AND id=$2", raw, doc["id"])
	}
	rollbackRaw, e := json.Marshal(rollback)
	if err == nil {
		err = e
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO documents(collection,id,data) VALUES('rollbacks',$1,$2)", groupID, rollbackRaw)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "hardening.rollback_queued", groupID, true, "")
	writeJSON(w, 200, doc)
}
