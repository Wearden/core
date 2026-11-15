package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/Wearden/proto/wire"
	"net/http"
	"sort"
	"strconv"
	"time"
)

func (s *Server) driftRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/drift", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {

		rows, err := s.DB.QueryContext(r.Context(), `SELECT data FROM documents WHERE collection='drift' AND ($1=false OR data->>'active'='true') ORDER BY created_at DESC,id DESC LIMIT 500`, r.URL.Query().Get("active_only") != "false")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var raw []byte
			if err := rows.Scan(&raw); err != nil {
				s.databaseError(w, err)
				return
			}
			var doc map[string]any
			if err := json.Unmarshal(raw, &doc); err != nil {
				s.databaseError(w, err)
				return
			}
			out = append(out, doc)
		}
		if rows.Err() != nil {
			s.databaseError(w, rows.Err())
			return
		}
		writeJSON(w, 200, out)
	}))
	m.HandleFunc("POST /api/drift/run", s.require("operator", func(w http.ResponseWriter, r *http.Request) {
		runs, err := s.featureDocuments(r.Context(), "hardening")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		assets := map[int64]bool{}
		for _, run := range runs {
			for _, c := range featureMaps(run["changes"]) {
				if text(c["status"]) == "applied" && text(c["rollback_status"]) != "reverted" {
					assets[integer(c["asset_id"])] = true
				}
			}
		}
		groups := map[string][]int64{}
		for aid := range assets {
			var bid string
			if s.DB.QueryRowContext(r.Context(), "SELECT benchmark_id FROM agents WHERE asset_id=$1 AND NOT revoked", aid).Scan(&bid) == nil {
				groups[bid] = append(groups[bid], aid)
			}
		}
		queued := []string{}
		keys := []string{}
		for bid := range groups {
			keys = append(keys, bid)
		}
		sort.Strings(keys)
		for _, bid := range keys {
			ids := groups[bid]
			sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
			for start := 0; start < len(ids); start += 200 {
				end := min(start+200, len(ids))
				doc, err := s.queueScan(r.Context(), scanInput{Name: "Drift recheck", Benchmark: bid, Profile: "full", AssetIDs: ids[start:end]}, current(r).Username)
				if err != nil {
					problem(w, 409, "Some drift rechecks could not be queued; previously queued jobs remain visible")
					return
				}
				queued = append(queued, text(doc["id"]))
			}
		}
		s.audit(r, "drift.recheck_queued", "", true, "")
		writeJSON(w, 202, map[string]any{"queued": len(queued) > 0, "scan_ids": queued})
	}))
}
func (s *Server) reconcileDrift(ctx context.Context, tx *sql.Tx, a agent, report wire.Report) error {
	rows, err := tx.QueryContext(ctx, `SELECT data FROM documents WHERE collection='hardening' AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'changes') c WHERE c->>'asset_id'=$1 AND c->>'status'='applied') ORDER BY created_at DESC,id DESC`, strconv.FormatInt(a.AssetID, 10))
	if err != nil {
		return err
	}
	baseline := map[string]map[string]any{}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			rows.Close()
			return err
		}
		var doc map[string]any
		if err = json.Unmarshal(raw, &doc); err != nil {
			rows.Close()
			return err
		}
		for _, c := range featureMaps(doc["changes"]) {
			id := text(c["control_id"])
			if _, exists := baseline[id]; exists || integer(c["asset_id"]) != a.AssetID {
				continue
			}
			if text(c["rollback_status"]) == "reverted" {
				baseline[id] = nil
				continue
			}
			if text(c["status"]) != "applied" {
				continue
			}
			at, e := time.Parse(time.RFC3339Nano, text(c["updated_at"]))
			if e != nil || report.FinishedAt.Before(at) {
				continue
			}
			c["run_id"] = doc["id"]
			baseline[id] = c
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, finding := range report.Findings {
		before := baseline[finding.RuleID]
		if before == nil {
			continue
		}
		key := digest(a.ID + ":" + finding.RuleID + ":" + text(before["run_id"]))
		if finding.Status == wire.Pass {
			_, err = tx.ExecContext(ctx, `UPDATE documents SET data=data||jsonb_build_object('active',false,'resolved_at',now()) WHERE collection='drift' AND id=$1`, key)
			if err != nil {
				return err
			}
			continue
		}
		if finding.Status == wire.NotApplicable {
			continue
		}
		message := "Control " + finding.RuleID + " no longer passes after hardening"
		kind := "configuration_drift"
		if finding.Status == wire.Error {
			message = "Unable to recheck hardened control " + finding.RuleID
			kind = "observation_error"
		}
		eventID, err := nextID(ctx, tx, "finding")
		if err != nil {
			return err
		}
		event := map[string]any{"id": eventID, "asset_id": a.AssetID, "asset_name": a.Hostname, "run_id": before["run_id"], "control_id": finding.RuleID, "severity": finding.Severity, "message": message, "kind": kind, "detected_at": report.FinishedAt, "active": true, "resolved_at": nil}
		raw, err := json.Marshal(event)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO documents(collection,id,data) VALUES('drift',$1,$2) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data||jsonb_build_object('id',documents.data->'id','detected_at',CASE WHEN documents.data->>'active'='true' THEN documents.data->'detected_at' ELSE excluded.data->'detected_at' END)`, key, raw)
		if err != nil {
			return err
		}
	}
	return nil
}
