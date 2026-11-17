package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (s *Server) featureRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/audit", s.require("viewer", s.featureAudit))
	mux.HandleFunc("GET /api/analytics/dashboard", s.require("viewer", s.featureDashboard))
	mux.HandleFunc("GET /api/analytics/hosts/{id}", s.require("viewer", s.featureHost))
	mux.HandleFunc("GET /api/analytics/heatmap", s.require("viewer", s.featureHeatmap))
	mux.HandleFunc("GET /api/analytics/diff", s.require("viewer", s.featureDiff))
	mux.HandleFunc("GET /api/attack/coverage", s.require("viewer", s.featureAttack))
	mux.HandleFunc("GET /api/copilot/status", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		key, _ := s.setting(r.Context(), "anthropic_api_key")
		model, _ := s.setting(r.Context(), "anthropic_model")
		writeJSON(w, 200, map[string]any{"enabled": key != "" && model != ""})
	}))
	mux.HandleFunc("POST /api/copilot/explain", s.require("viewer", s.featureExplain))
	mux.HandleFunc("GET /api/reports/scans/{file}", s.require("viewer", s.featureScanExport))
	mux.HandleFunc("GET /api/reports/hardening/{file}", s.require("viewer", s.featureHardeningExport))
	mux.HandleFunc("GET /api/reports/rollbacks/{file}", s.require("viewer", s.featureRollbackExport))
	mux.HandleFunc("GET /api/sessions", s.require("operator", s.featureSessions))
	mux.HandleFunc("POST /api/sessions", s.require("operator", s.featureOpenSession))
	mux.HandleFunc("GET /api/assets/{id}/rdp-certificate", s.require("operator", s.rdpCertificateInfo))
	mux.HandleFunc("POST /api/sessions/{id}/end", s.require("operator", s.featureEndSession))
	mux.HandleFunc("GET /api/sessions/{id}/recording", s.require("operator", s.featureRecording))
	mux.HandleFunc("DELETE /api/sessions/{id}", s.requirePerm("recordings.delete", s.featureDeleteSession))
}

func (s *Server) featureAudit(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.QueryContext(r.Context(), "SELECT id,created_at,username,action,target,success,ip,detail FROM audit_log ORDER BY created_at DESC,id DESC LIMIT $1", limit(r, 1000))
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var at time.Time
		var username, target, ip, detail *string
		var action string
		var success bool
		if err := rows.Scan(&id, &at, &username, &action, &target, &success, &ip, &detail); err != nil {
			s.databaseError(w, err)
			return
		}
		out = append(out, map[string]any{"id": id, "created_at": at.UTC().Format(time.RFC3339Nano), "username": username, "action": action, "target": target, "success": success, "ip": ip, "detail": detail})
	}
	if err := rows.Err(); err != nil {
		s.databaseError(w, err)
		return
	}
	writeJSON(w, 200, out)
}

// Read every durable document for aggregate endpoints, avoiding Store.List's 500-row UI limit.
func (s *Server) featureDocuments(ctx context.Context, collection string) ([]map[string]any, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT data FROM documents WHERE collection=$1 ORDER BY created_at ASC,id ASC", collection)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		out = append(out, doc)
	}
	return out, rows.Err()
}

func featureMaps(value any) []map[string]any {
	if values, ok := value.([]map[string]any); ok {
		return values
	}
	out := []map[string]any{}
	if values, ok := value.([]any); ok {
		for _, value := range values {
			if item, ok := value.(map[string]any); ok {
				out = append(out, item)
			}
		}
	}
	return out
}
func featureNumber(value any) (float64, bool) {
	switch n := value.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, e := n.Float64()
		return f, e == nil
	}
	return 0, false
}
func featureRate(pass, total int) any {
	if total == 0 {
		return nil
	}
	return float64(pass) * 100 / float64(total)
}
func featurePoint(scan, host map[string]any) map[string]any {
	return map[string]any{"scan_id": scan["id"], "scan_name": scan["name"], "at": scan["finished_at"], "score": host["score"], "weighted_score": host["weighted_score"]}
}

func (s *Server) featureExplain(w http.ResponseWriter, r *http.Request) {
	var in struct {
		BenchmarkID string `json:"benchmark_id"`
		ControlID   string `json:"control_id"`
		Language    string `json:"language"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Language != "" && in.Language != "en" && in.Language != "az" {
		problem(w, 400, "Unsupported language")
		return
	}
	b := s.Catalog[in.BenchmarkID]
	if b == nil {
		problem(w, 404, "Benchmark not found")
		return
	}
	c, ok := b.Controls[in.ControlID]
	if !ok {
		problem(w, 404, "Control not found")
		return
	}
	result := map[string]any{"control_id": c.ID, "source": "static", "text": fmt.Sprintf("%s\n\n%s\n\n%s\n\n%s", c.Title, c.Description, c.Rationale, c.Impact)}
	aiKey, _ := s.setting(r.Context(), "anthropic_api_key")
	aiModel, _ := s.setting(r.Context(), "anthropic_model")
	if aiKey != "" && aiModel != "" {
		language := "English"
		if in.Language == "az" {
			language = "Azerbaijani"
		}
		// Explicit allowlist: no host identifiers, evidence, credentials or commands leave the server.
		prompt, _ := json.Marshal(map[string]any{"title": c.Title, "cis_ref": c.CISRef, "severity": c.Severity, "description": c.Description, "rationale": c.Rationale, "impact": c.Impact, "mitre_attack": c.MitreAttack})
		body, err := json.Marshal(map[string]any{"model": aiModel, "max_tokens": 700, "system": "Explain this security control in " + language + ". Give a concise explanation, business impact and safe next step. Use only the supplied catalog facts.", "messages": []map[string]string{{"role": "user", "content": string(prompt)}}})
		if err == nil {
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
			if err == nil {
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("x-api-key", aiKey)
				req.Header.Set("anthropic-version", "2023-06-01")
				client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
				resp, err := client.Do(req)
				if err == nil {
					defer resp.Body.Close()
					if resp.StatusCode == 200 {
						var payload struct {
							Content []struct {
								Type string `json:"type"`
								Text string `json:"text"`
							} `json:"content"`
						}
						if json.NewDecoder(io.LimitReader(resp.Body, 1024*1024)).Decode(&payload) == nil {
							var content strings.Builder
							for _, p := range payload.Content {
								if p.Type == "text" {
									content.WriteString(p.Text)
								}
							}
							if answer := strings.TrimSpace(content.String()); answer != "" {
								result["source"] = "ai"
								result["text"] = answer
							}
						}
					}
				}
			}
		}
		if result["source"] == "static" {
			slog.Warn("copilot provider unavailable; catalog explanation returned")
			result["fallback_reason"] = "AI provider unavailable"
		}
	}
	writeJSON(w, 200, result)
}

func featureSortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
