package app

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Wearden/proto/wire"
)

func (s *Server) nextActionTask(w http.ResponseWriter, r *http.Request) {
	a, err := s.agentIdentity(r)
	if err != nil {
		problem(w, 401, "Invalid agent credential")
		return
	}
	var raw []byte
	err = s.DB.QueryRowContext(r.Context(), "SELECT task FROM action_jobs WHERE agent_id=$1 AND state='queued' AND deadline>now() ORDER BY created_at,id LIMIT 1", a.ID).Scan(&raw)
	if err == sql.ErrNoRows {
		writeJSON(w, 200, wire.TaskEnvelope{})
		return
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	var task wire.Task
	if json.Unmarshal(raw, &task) != nil {
		problem(w, 500, "Invalid stored task")
		return
	}
	writeJSON(w, 200, wire.TaskEnvelope{Task: &task})
}
func (s *Server) actionResult(w http.ResponseWriter, r *http.Request) {
	a, err := s.agentIdentity(r)
	if err != nil {
		problem(w, 401, "Invalid agent credential")
		return
	}
	var in wire.TaskResult
	if !decode(w, r, &in) {
		return
	}
	if in.Revision < 0 || in.Revision > 1 || in.Version != wire.Version || in.AgentID != a.ID || in.TaskID != r.PathValue("id") || len(in.Changes) < 1 || len(in.Changes) > 200 || (in.Status != "completed" && in.Status != "failed") {
		problem(w, 400, "Invalid task result identity or status")
		return
	}
	canonical, err := json.Marshal(in)
	if err != nil {
		problem(w, 400, "Invalid task result")
		return
	}
	checksum := digest(string(canonical))
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var live string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM agents WHERE id=$1 AND NOT revoked AND token_hash=$2 FOR UPDATE", a.ID, digest(bearer(r))).Scan(&live) != nil {
		problem(w, 401, "Agent revoked")
		return
	}
	var taskRaw, previousRaw []byte
	var oldHash *string
	var runID, groupID, jobState string
	err = tx.QueryRowContext(r.Context(), "SELECT task,result_digest,run_id,group_id,state,result FROM action_jobs WHERE id=$1 AND agent_id=$2 FOR UPDATE", in.TaskID, a.ID).Scan(&taskRaw, &oldHash, &runID, &groupID, &jobState, &previousRaw)
	if err != nil {
		problem(w, 403, "Task is not assigned to agent")
		return
	}

	var historicalHash string
	historyErr := tx.QueryRowContext(r.Context(), "SELECT digest FROM action_result_history WHERE task_id=$1 AND revision=$2", in.TaskID, in.Revision).Scan(&historicalHash)
	if historyErr == nil {
		if historicalHash != checksum {
			problem(w, 409, "Task result revision conflict")
			return
		}
		writeJSON(w, 200, wire.TaskReceipt{TaskID: in.TaskID, Revision: in.Revision, Accepted: true})
		return
	}
	if historyErr != sql.ErrNoRows {
		s.databaseError(w, historyErr)
		return
	}
	if oldHash != nil {
		var previous wire.TaskResult
		if json.Unmarshal(previousRaw, &previous) != nil {
			problem(w, 500, "Invalid prior task result")
			return
		}
		if previous.Revision == in.Revision {
			if *oldHash != checksum {
				problem(w, 409, "Task result ID conflict")
				return
			}
			writeJSON(w, 200, wire.TaskReceipt{TaskID: in.TaskID, Revision: in.Revision, Accepted: true})
			return
		}
		if previous.Revision != 0 || in.Revision != 1 {
			problem(w, 409, "Invalid task result revision transition")
			return
		}
		if _, err = tx.ExecContext(r.Context(), "INSERT INTO action_result_history(task_id,revision,digest,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", in.TaskID, previous.Revision, *oldHash, previousRaw); err != nil {
			s.databaseError(w, err)
			return
		}
	}
	var task wire.Task
	if json.Unmarshal(taskRaw, &task) != nil || len(task.RuleIDs) != len(in.Changes) {
		problem(w, 400, "Task result must account for every assigned rule")
		return
	}
	if in.Revision == 1 && (task.Action != "apply" || in.Status != "failed") {
		problem(w, 400, "Revision1 is only a failed/compensated apply result")
		return
	}
	expected := map[string]bool{}
	for _, id := range task.RuleIDs {
		expected[id] = true
	}
	seen := map[string]bool{}
	for _, change := range in.Changes {
		if in.Revision == 1 && !oneOfFeature(change.Status, "failed", "skipped") {
			problem(w, 400, "Compensated results cannot assert applied changes")
			return
		}
		if !expected[change.RuleID] || seen[change.RuleID] || len(change.BeforeValue) > 4096 || len(change.AfterValue) > 4096 || len(change.Message) > 4096 || len(change.BackupID) > 256 || strings.ContainsAny(change.BackupID, "\r\n") {
			problem(w, 400, "Invalid or duplicate task change")
			return
		}
		seen[change.RuleID] = true
		if task.Action == "apply" && !oneOfFeature(change.Status, "applied", "skipped", "failed") {
			problem(w, 400, "Invalid apply result")
			return
		}
		if task.Action == "rollback" && !oneOfFeature(change.Status, "reverted", "failed") {
			problem(w, 400, "Invalid rollback result")
			return
		}
		if !oneOfFeature(change.BeforeStatus, "", "pass", "fail", "error", "not_applicable") || !oneOfFeature(change.AfterStatus, "", "pass", "fail", "error", "not_applicable") {
			problem(w, 400, "Invalid check result")
			return
		}
		if change.Status == "applied" && (change.AfterStatus != "pass" || change.BackupID == "") {
			problem(w, 400, "Applied changes require verified status and a backup locator")
			return
		}
	}
	var raw []byte
	if err = tx.QueryRowContext(r.Context(), "SELECT data FROM documents WHERE collection='hardening' AND id=$1 FOR UPDATE", runID).Scan(&raw); err != nil {
		s.databaseError(w, err)
		return
	}
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		problem(w, 500, "Invalid stored run")
		return
	}
	for _, result := range in.Changes {
		matched := false
		for _, change := range featureMaps(doc["changes"]) {
			if integer(change["asset_id"]) != a.AssetID || text(change["control_id"]) != result.RuleID {
				continue
			}
			matched = true
			change["updated_at"] = now()
			change["message"] = result.Message
			if task.Action == "apply" {
				change["status"] = result.Status
				change["before_status"] = result.BeforeStatus
				change["after_status"] = result.AfterStatus
				change["before_value"] = result.BeforeValue
				change["after_value"] = result.AfterValue
				if result.BackupID != "" {
					change["backups"] = []string{result.BackupID}
				}
			} else {
				change["rollback_status"] = result.Status
				change["rollback_value"] = result.AfterValue
			}
		}
		if !matched {
			problem(w, 403, "Task result refers to unassigned asset change")
			return
		}

		if (task.Action == "rollback" && result.Status == "reverted") || (in.Revision == 1 && result.Status == "failed") {
			_, err = tx.ExecContext(r.Context(), `UPDATE documents SET data=data||jsonb_build_object('active',false,'resolved_at',now(),'resolution','Baseline withdrawn by rollback or watchdog recovery') WHERE collection='drift' AND data->>'asset_id'=$1 AND data->>'control_id'=$2 AND data->>'run_id'=$3`, strconv.FormatInt(a.AssetID, 10), result.RuleID, runID)
			if err != nil {
				s.databaseError(w, err)
				return
			}
		}
	}
	_, err = tx.ExecContext(r.Context(), "UPDATE action_jobs SET state='completed',result=$1,result_digest=$2 WHERE id=$3", canonical, checksum, in.TaskID)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	done, applied, failed := 0, 0, 0
	for _, c := range featureMaps(doc["changes"]) {
		switch text(c["status"]) {
		case "applied":
			done++
			applied++
		case "skipped":
			done++
		case "failed":
			done++
			failed++
		}
	}
	doc["done_changes"] = done
	doc["applied_count"] = applied
	if doc["started_at"] == nil {
		doc["started_at"] = now()
	}
	if task.Action == "apply" && text(doc["status"]) != "cancelled" && text(doc["status"]) != "failed" {
		doc["status"] = "running"
		if done == int(integer(doc["total_changes"])) {
			doc["status"] = "completed"
			if failed > 0 {
				doc["status"] = "failed"
			}
			doc["finished_at"] = now()
		}
	}
	if task.Action == "rollback" && groupID != "" {
		var rollbackRaw []byte
		if err = tx.QueryRowContext(r.Context(), "SELECT data FROM documents WHERE collection='rollbacks' AND id=$1 FOR UPDATE", groupID).Scan(&rollbackRaw); err != nil {
			s.databaseError(w, err)
			return
		}
		var rollback map[string]any
		if json.Unmarshal(rollbackRaw, &rollback) != nil {
			problem(w, 500, "Invalid rollback record")
			return
		}
		reverted, bad := int(integer(rollback["reverted"])), int(integer(rollback["failed"]))
		for _, c := range in.Changes {
			if c.Status == "reverted" {
				reverted++
			} else {
				bad++
			}
		}
		rollback["reverted"] = reverted
		rollback["failed"] = bad
		rollback["status"] = "running"
		rollback["started_at"] = rollback["created_at"]
		if reverted+bad == int(integer(rollback["total"])) {
			rollback["status"] = "completed"
			doc["status"] = "rolled_back"
			if bad > 0 {
				rollback["status"] = "failed"
				doc["status"] = "rollback_failed"
			}
			rollback["finished_at"] = now()
		}
		rollbackRaw, err = json.Marshal(rollback)
		if err == nil {
			_, err = tx.ExecContext(r.Context(), "UPDATE documents SET data=$1 WHERE collection='rollbacks' AND id=$2", rollbackRaw, groupID)
		}
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO action_result_history(task_id,revision,digest,data) VALUES($1,$2,$3,$4)", in.TaskID, in.Revision, checksum, canonical)
	}
	raw, e := json.Marshal(doc)
	if err == nil {
		err = e
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE documents SET data=$1 WHERE collection='hardening' AND id=$2", raw, runID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "hardening.task_result", in.TaskID, true, "")
	writeJSON(w, 200, wire.TaskReceipt{TaskID: in.TaskID, Revision: in.Revision, Accepted: true})
}
