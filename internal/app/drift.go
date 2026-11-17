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
		// Agentless hosts are rechecked against the benchmark that hardened them, on those controls only.
		pamHosts := map[string]map[int64]bool{}
		pamControls := map[string]map[string]bool{}
		for _, run := range runs {
			bid := text(run["benchmark_id"])
			for _, c := range featureMaps(run["changes"]) {
				if text(c["status"]) != "applied" || text(c["rollback_status"]) == "reverted" {
					continue
				}
				aid := integer(c["asset_id"])
				assets[aid] = true
				if text(run["mode"]) == "pam" {
					if pamHosts[bid] == nil {
						pamHosts[bid], pamControls[bid] = map[int64]bool{}, map[string]bool{}
					}
					pamHosts[bid][aid] = true
					pamControls[bid][text(c["control_id"])] = true
				}
			}
		}
		groups := map[string][]int64{}
		for aid := range assets {
			var bid string
			if s.DB.QueryRowContext(r.Context(), "SELECT benchmark_id FROM agents WHERE asset_id=$1 AND NOT revoked", aid).Scan(&bid) == nil {
				groups[bid] = append(groups[bid], aid)
				for _, hosts := range pamHosts {
					delete(hosts, aid) // an enrolled agent rechecks it already
				}
			}
		}
		queued, hostCount, skipped := []string{}, 0, []string{}
		pamKeys := []string{}
		for bid := range pamHosts {
			pamKeys = append(pamKeys, bid)
		}
		sort.Strings(pamKeys)
		for _, bid := range pamKeys {
			b := s.Catalog[bid]
			ids := []string{}
			for cid := range pamControls[bid] {
				if b != nil {
					if _, ok := b.Controls[cid]; ok {
						ids = append(ids, cid)
					}
				}
			}
			sort.Strings(ids)
			aids := []int64{}
			for aid := range pamHosts[bid] {
				a, err := s.asset(r.Context(), aid)
				switch {
				case err != nil:
					continue // asset deleted since it was hardened
				case !isPAMConnection(assetConnection(a)) || a["credential_username"] == nil || b == nil || text(a["os_type"]) != b.OS:
					skipped = append(skipped, text(a["name"]))
				default:
					aids = append(aids, aid)
				}
			}
			if len(aids) == 0 || len(ids) == 0 {
				continue
			}
			sort.Slice(aids, func(i, j int) bool { return aids[i] < aids[j] })
			for start := 0; start < len(aids); start += 200 {
				end := min(start+200, len(aids))
				doc, err := s.pamQueueScan(r.Context(), "Drift recheck", bid, "drift", b, ids, aids[start:end], current(r).Username)
				if err != nil {
					problem(w, 409, "Some drift rechecks could not be queued; previously queued jobs remain visible")
					return
				}
				queued = append(queued, text(doc["id"]))
				hostCount += end - start
			}
		}
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
				hostCount += end - start
			}
		}
		sort.Strings(skipped)
		s.audit(r, "drift.recheck_queued", "", len(queued) > 0, strconv.Itoa(hostCount)+" hosts")
		writeJSON(w, 202, map[string]any{"queued": len(queued) > 0, "scan_ids": queued, "hosts": hostCount, "hardened_hosts": len(assets), "skipped": skipped})
	}))
}

// reconcileDrift compares fresh results for one asset with the controls hardening fixed there.
// A fixed control that fails again raises an alert; one that passes again clears it.
// Agent reports and agentless (PAM) scans both feed it; source keeps their alerts apart
// (the agent ID, or "pam:<asset id>").
func (s *Server) reconcileDrift(ctx context.Context, tx *sql.Tx, assetID int64, assetName, source string, finishedAt time.Time, findings []wire.Finding) error {
	rows, err := tx.QueryContext(ctx, `SELECT data FROM documents WHERE collection='hardening' AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'changes') c WHERE c->>'asset_id'=$1 AND c->>'status'='applied') ORDER BY created_at DESC,id DESC`, strconv.FormatInt(assetID, 10))
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
			if _, exists := baseline[id]; exists || integer(c["asset_id"]) != assetID {
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
			if e != nil || finishedAt.Before(at) {
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
	for _, finding := range findings {
		before := baseline[finding.RuleID]
		if before == nil {
			continue
		}
		key := digest(source + ":" + finding.RuleID + ":" + text(before["run_id"]))
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
		event := map[string]any{"id": eventID, "asset_id": assetID, "asset_name": assetName, "run_id": before["run_id"], "control_id": finding.RuleID, "severity": finding.Severity, "message": message, "kind": kind, "detected_at": finishedAt, "active": true, "resolved_at": nil}
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
