package app

import (
	"encoding/json"
	"github.com/Wearden/core/internal/security"
	"net/http"
	"sort"
	"strings"
)

func (s *Server) benchmarkRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/benchmarks", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		keys := []string{}
		for id := range s.Catalog {
			keys = append(keys, id)
		}
		sort.Strings(keys)
		out := []map[string]any{}
		for _, id := range keys {
			out = append(out, s.Catalog[id].Summary())
		}
		writeJSON(w, 200, out)
	}))
	m.HandleFunc("GET /api/benchmarks/{bid}/controls", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		b := s.Catalog[r.PathValue("bid")]
		if b == nil {
			problem(w, 404, "Benchmark not found")
			return
		}
		out := []any{}
		keys := []string{}
		for id := range b.Controls {
			keys = append(keys, id)
		}
		sort.Strings(keys)
		for _, id := range keys {
			c := b.Controls[id]
			q := strings.ToLower(r.URL.Query().Get("q"))
			if v := r.URL.Query().Get("severity"); v != "" && v != c.Severity {
				continue
			}
			if v := r.URL.Query().Get("category"); v != "" && v != c.Category {
				continue
			}
			if q != "" && !strings.Contains(strings.ToLower(c.ID+" "+c.Title), q) {
				continue
			}
			out = append(out, c)
		}
		writeJSON(w, 200, out)
	}))
	m.HandleFunc("GET /api/benchmarks/{bid}/controls/{cid}", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		b := s.Catalog[r.PathValue("bid")]
		if b == nil {
			problem(w, 404, "Benchmark not found")
			return
		}
		c, ok := b.Controls[r.PathValue("cid")]
		if !ok {
			problem(w, 404, "Control not found")
			return
		}
		writeJSON(w, 200, c)
	}))
	m.HandleFunc("GET /api/benchmarks/{bid}/profiles", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		b := s.Catalog[r.PathValue("bid")]
		if b == nil {
			problem(w, 404, "Benchmark not found")
			return
		}
		out := []any{}
		for _, p := range b.Profiles {
			out = append(out, p)
		}
		saved, err := s.Store.List(r.Context(), "profiles")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		for _, p := range saved {
			if text(p["benchmark_id"]) == b.ID {
				out = append(out, p)
			}
		}
		writeJSON(w, 200, out)
	}))
	m.HandleFunc("POST /api/benchmarks/{bid}/profiles", s.require("operator", func(w http.ResponseWriter, r *http.Request) {
		b := s.Catalog[r.PathValue("bid")]
		if b == nil {
			problem(w, 404, "Benchmark not found")
			return
		}
		var in struct {
			Name string   `json:"name"`
			IDs  []string `json:"control_ids"`
		}
		if !decode(w, r, &in) {
			return
		}
		if in.Name == "" || len(in.Name) > 100 || len(in.IDs) == 0 || len(in.IDs) > 10000 {
			problem(w, 400, "Invalid profile")
			return
		}
		seen := map[string]bool{}
		for _, id := range in.IDs {
			if _, ok := b.Controls[id]; !ok || seen[id] {
				problem(w, 400, "Unknown or duplicate control")
				return
			}
			seen[id] = true
		}
		id, err := security.ID()
		if err != nil {
			problem(w, 500, "Cannot create profile")
			return
		}
		out := map[string]any{"id": id, "benchmark_id": b.ID, "name": in.Name, "description": "Custom profile", "builtin": false, "control_ids": in.IDs}
		if err = s.Store.Put(r.Context(), "profiles", id, out); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "profile.created", id, true, "")
		writeJSON(w, 201, out)
	}))
	m.HandleFunc("DELETE /api/benchmarks/{bid}/profiles/{pid}", s.require("operator", func(w http.ResponseWriter, r *http.Request) {
		result, err := s.DB.ExecContext(r.Context(), "DELETE FROM documents WHERE collection='profiles' AND id=$1 AND data->>'benchmark_id'=$2", r.PathValue("pid"), r.PathValue("bid"))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			problem(w, 404, "Custom profile not found")
			return
		}
		s.audit(r, "profile.deleted", r.PathValue("pid"), true, "")
		w.WriteHeader(204)
	}))
}
func (s *Server) selectControls(r *http.Request, bid, pid string) ([]string, error) {
	b := s.Catalog[bid]
	if b == nil {
		return nil, errNotAssigned
	}
	ids, err := b.Select(pid)
	if err == nil {
		return ids, nil
	}
	saved, err := s.Store.Get(r.Context(), "profiles", pid)
	if err != nil || text(saved["benchmark_id"]) != bid {
		return nil, errNotAssigned
	}
	raw, err := json.Marshal(saved["control_ids"])
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(raw, &ids)
	return ids, err
}
