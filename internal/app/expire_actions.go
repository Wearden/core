package app

import (
	"context"
	"database/sql"
	"encoding/json"
)

func (s *Server) expireActions(ctx context.Context) error {
	for n := 0; n < 100; n++ {
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		var taskID, runID, action, groupID string
		var raw []byte
		err = tx.QueryRowContext(ctx, "SELECT id,run_id,action,group_id,task FROM action_jobs WHERE state='queued' AND deadline<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1").Scan(&taskID, &runID, &action, &groupID, &raw)
		if err == sql.ErrNoRows {
			tx.Rollback()
			return nil
		}
		if err != nil {
			tx.Rollback()
			return err
		}
		var task struct {
			IDs []string `json:"rule_ids"`
		}
		if err = json.Unmarshal(raw, &task); err != nil {
			tx.Rollback()
			return err
		}
		var agentAsset int64
		if err = tx.QueryRowContext(ctx, "SELECT COALESCE(a.asset_id,0) FROM action_jobs j JOIN agents a ON a.id=j.agent_id WHERE j.id=$1", taskID).Scan(&agentAsset); err != nil {
			tx.Rollback()
			return err
		}
		err = tx.QueryRowContext(ctx, "SELECT data FROM documents WHERE collection='hardening' AND id=$1 FOR UPDATE", runID).Scan(&raw)
		if err != nil {
			tx.Rollback()
			return err
		}
		var doc map[string]any
		if err = json.Unmarshal(raw, &doc); err != nil {
			tx.Rollback()
			return err
		}
		ids := map[string]bool{}
		for _, id := range task.IDs {
			ids[id] = true
		}
		for _, change := range featureMaps(doc["changes"]) {
			if integer(change["asset_id"]) == agentAsset && ids[text(change["control_id"])] {
				if action == "apply" && text(change["status"]) == "pending" {
					change["status"] = "failed"
				}
				if action == "rollback" && text(change["rollback_status"]) == "pending" {
					change["rollback_status"] = "failed"
				}
				change["message"] = "Agent task expired before durable result delivery; late evidence may still arrive"
			}
		}
		if text(doc["status"]) != "cancelled" {
			doc["status"] = "failed"
			doc["finished_at"] = now()
			doc["message"] = "Agent action deadline exceeded"
		}
		raw, err = json.Marshal(doc)
		if err == nil {
			_, err = tx.ExecContext(ctx, "UPDATE documents SET data=$1 WHERE collection='hardening' AND id=$2", raw, runID)
		}
		if err == nil && groupID != "" {
			_, err = tx.ExecContext(ctx, `UPDATE documents SET data=data||jsonb_build_object('status','failed','finished_at',now(),'message','Agent rollback deadline exceeded') WHERE collection='rollbacks' AND id=$1`, groupID)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, "UPDATE action_jobs SET state='expired' WHERE id=$1", taskID)
		}
		if err == nil {
			err = tx.Commit()
		} else {
			tx.Rollback()
		}
		if err != nil {
			return err
		}
	}
	return nil
}
