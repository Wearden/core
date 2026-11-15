package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/Wearden/core/internal/security"
	"net/http"
	"strconv"
)

var errNotAssigned = errors.New("benchmark/profile/agent assignment is not available")

type scanInput struct {
	Name      string  `json:"name"`
	Benchmark string  `json:"benchmark_id"`
	Profile   string  `json:"profile_id"`
	AssetIDs  []int64 `json:"asset_ids"`
}

func originalBenchmark(native string) string {
	switch native {
	case "ubuntu-24.04-native", "ubuntu-24.04-native-filesystem":
		return "ubuntu-24.04-cis"
	case "windows-10-native-registry":
		return "windows-10-cis"
	case "windows-11-native-registry":
		return "windows-11-cis"
	case "server-2022-native-registry":
		return "windows-server-2022-cis"
	}
	return native
}
func (s *Server) queueScan(ctx context.Context, in scanInput, username string) (map[string]any, error) {
	if len(in.AssetIDs) < 1 || len(in.AssetIDs) > 200 || len(in.Name) > 120 {
		return nil, errors.New("select 1..200 assets and a name up to 120 bytes")
	}
	ids, err := s.selectControls((&http.Request{}).WithContext(ctx), in.Benchmark, in.Profile)
	if err != nil || len(ids) == 0 {
		return nil, errNotAssigned
	}
	b := s.Catalog[in.Benchmark]
	if b == nil {
		return nil, errNotAssigned
	}
	scanID, err := security.ID()
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	hosts := []any{}
	seen := map[int64]bool{}
	for _, assetID := range in.AssetIDs {
		if seen[assetID] {
			return nil, errors.New("duplicate asset")
		}
		seen[assetID] = true
		var agentID, native, osName string
		var assetRaw []byte
		err = tx.QueryRowContext(ctx, "SELECT a.id,a.benchmark_id,a.os,x.data FROM agents a JOIN assets x ON x.id=a.asset_id WHERE a.asset_id=$1 AND NOT a.revoked FOR UPDATE OF a", assetID).Scan(&agentID, &native, &osName, &assetRaw)
		if err != nil || osName != b.OS || (in.Benchmark != native && in.Benchmark != originalBenchmark(native)) {
			return nil, fmt.Errorf("asset %d is not enrolled for the selected benchmark", assetID)
		}
		nb := s.Catalog[native]
		if nb == nil || len(nb.Native) == 0 {
			return nil, errNotAssigned
		}
		for _, cid := range ids {
			if _, ok := nb.Controls[cid]; !ok {
				return nil, fmt.Errorf("asset %d does not support control %s", assetID, cid)
			}
		}
		var asset map[string]any
		if json.Unmarshal(assetRaw, &asset) != nil {
			return nil, errors.New("invalid stored asset")
		}
		hostID, err := nextID(ctx, tx, "host")
		if err != nil {
			return nil, err
		}
		hosts = append(hosts, map[string]any{"id": hostID, "asset_id": assetID, "asset_name": asset["name"], "host": asset["host"], "os_detected": asset["os_detected"], "status": "pending", "passed": 0, "failed": 0, "errored": 0, "not_applicable": 0, "score": nil, "weighted_score": nil, "message": nil})
		jobID, err := security.ID()
		if err != nil {
			return nil, err
		}
		raw, err := json.Marshal(ids)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO agent_jobs(id,agent_id,scan_id,benchmark_id,rule_ids) VALUES($1,$2,$3,$4,$5)", jobID, agentID, scanID, native, raw)
		if err != nil {
			return nil, err
		}
	}
	name := in.Name
	if name == "" {
		name = b.Name + " scan"
	}
	doc := scanDocument(scanID, name, in.Benchmark, in.Profile, username, ids, hosts)
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO documents(collection,id,data) VALUES('scans',$1,$2)", scanID, raw)
	if err == nil {
		err = tx.Commit()
	}
	return doc, err
}
func (s *Server) scanRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/scans", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		docs, err := s.Store.List(r.Context(), "scans")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		for _, doc := range docs {
			delete(doc, "results")
			delete(doc, "hosts")
		}
		writeJSON(w, 200, docs)
	}))
	m.HandleFunc("POST /api/scans", s.require("operator", func(w http.ResponseWriter, r *http.Request) {
		var in scanInput
		if !decode(w, r, &in) {
			return
		}
		doc, err := s.queueScan(r.Context(), in, current(r).Username)
		if err != nil {
			problem(w, 409, err.Error())
			return
		}
		s.audit(r, "scan.queued", text(doc["id"]), true, "")
		writeJSON(w, 201, doc)
	}))
	m.HandleFunc("GET /api/scans/{id}", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		doc, err := s.Store.Get(r.Context(), "scans", r.PathValue("id"))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		delete(doc, "results")
		writeJSON(w, 200, doc)
	}))
	m.HandleFunc("GET /api/scans/{id}/results", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		doc, err := s.Store.Get(r.Context(), "scans", r.PathValue("id"))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		out := []any{}
		hostID, _ := strconv.ParseInt(r.URL.Query().Get("host_id"), 10, 64)
		status := r.URL.Query().Get("status_filter")
		for _, item := range array(doc["results"]) {
			row, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if hostID != 0 && integer(row["host_result_id"]) != hostID {
				continue
			}
			if status != "" && text(row["status"]) != status {
				continue
			}
			out = append(out, row)
		}
		writeJSON(w, 200, out)
	}))
	m.HandleFunc("POST /api/scans/{id}/cancel", s.require("operator", s.cancelScan))
}
func (s *Server) cancelScan(w http.ResponseWriter, r *http.Request) {
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var raw []byte
	err = tx.QueryRowContext(r.Context(), "SELECT data FROM documents WHERE collection='scans' AND id=$1 FOR UPDATE", r.PathValue("id")).Scan(&raw)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		problem(w, 500, "Invalid stored scan")
		return
	}
	if text(doc["status"]) == "completed" || text(doc["status"]) == "failed" {
		problem(w, 409, "Scan has already finished")
		return
	}
	doc["status"] = "cancelled"
	doc["finished_at"] = now()
	for _, h := range array(doc["hosts"]) {
		if row, ok := h.(map[string]any); ok && text(row["status"]) == "pending" {
			row["status"] = "cancelled"
		}
	}
	raw, err = json.Marshal(doc)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE documents SET data=$1 WHERE collection='scans' AND id=$2", raw, r.PathValue("id"))
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE agent_jobs SET state='cancelled' WHERE scan_id=$1 AND state='queued'", r.PathValue("id"))
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "scan.cancelled", r.PathValue("id"), true, "")
	writeJSON(w, 200, doc)
}
