package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Agentic report analysis. The model may call two read-only tools over one scan
// and returns advisory decisions; nothing is applied. Only aggregated control
// facts leave the server: no host names, evidence values or credentials.
const aiMaxTurns = 6

var aiTools = []map[string]any{
	{"name": "list_findings", "description": "List failing or errored controls of the scan with affected host counts. No host identifiers are included.",
		"input_schema": map[string]any{"type": "object", "properties": map[string]any{}}},
	{"name": "get_control", "description": "Get catalog facts for one control and whether the platform can remediate and roll it back automatically.",
		"input_schema": map[string]any{"type": "object", "properties": map[string]any{"control_id": map[string]any{"type": "string"}}, "required": []string{"control_id"}}},
}

func (s *Server) aiRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/ai/status", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		p, err := s.aiResolve(r.Context(), "")
		if err != nil {
			writeJSON(w, 200, map[string]any{"enabled": false})
			return
		}
		writeJSON(w, 200, map[string]any{"enabled": true, "provider": p.Name, "model": p.Model})
	}))
	mux.HandleFunc("POST /api/ai/analyze", s.require("operator", s.aiAnalyze))
	mux.HandleFunc("POST /api/ai/chat", s.require("viewer", s.aiChat))
	mux.HandleFunc("GET /api/ai/analyses/{scan_id}", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		doc, err := s.Store.Get(r.Context(), "ai_analyses", r.PathValue("scan_id"))
		if errors.Is(err, sql.ErrNoRows) {
			problem(w, 404, "No analysis stored for this scan")
			return
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, doc)
	}))
}

func (s *Server) aiAnalyze(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ScanID     string `json:"scan_id"`
		Language   string `json:"language"`
		ProviderID string `json:"provider_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Language != "" && in.Language != "en" && in.Language != "az" {
		problem(w, 400, "Unsupported language")
		return
	}
	prov, err := s.aiResolve(r.Context(), in.ProviderID)
	if err != nil {
		problem(w, 503, "No AI provider is configured; an administrator can add one under Settings")
		return
	}
	scan, err := s.Store.Get(r.Context(), "scans", in.ScanID)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	b := s.Catalog[text(scan["benchmark_id"])]
	if b == nil {
		problem(w, 404, "Benchmark not found for this scan")
		return
	}
	// Per-control aggregate; hosts are counted, never named.
	type agg struct {
		ID, Title, Severity string
		Failed, Errored     int
		hosts               map[int64]bool
	}
	byControl := map[string]*agg{}
	allHosts := map[int64]bool{}
	for _, item := range array(scan["results"]) {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		host := integer(row["host_result_id"])
		allHosts[host] = true
		st := text(row["status"])
		if st != "fail" && st != "error" {
			continue
		}
		id := text(row["control_id"])
		a := byControl[id]
		if a == nil {
			a = &agg{ID: id, Title: text(row["title"]), Severity: text(row["severity"]), hosts: map[int64]bool{}}
			byControl[id] = a
		}
		if !a.hosts[host] {
			a.hosts[host] = true
			if st == "fail" {
				a.Failed++
			} else {
				a.Errored++
			}
		}
	}
	if len(byControl) == 0 {
		problem(w, 409, "Scan has no failing or errored controls to analyze")
		return
	}
	findings := []map[string]any{}
	for _, id := range featureSortedKeys(byControl) {
		a := byControl[id]
		findings = append(findings, map[string]any{"control_id": a.ID, "title": a.Title, "severity": a.Severity, "failed_hosts": a.Failed, "errored_hosts": a.Errored, "scanned_hosts": len(allHosts)})
	}
	runTool := func(name string, input map[string]any) string {
		switch name {
		case "list_findings":
			out, _ := json.Marshal(findings)
			return string(out)
		case "get_control":
			id, _ := input["control_id"].(string)
			c, ok := b.Controls[id]
			if !ok || byControl[id] == nil {
				return `{"error":"control is not a failing control of this scan"}`
			}
			out, _ := json.Marshal(map[string]any{"control_id": c.ID, "title": c.Title, "severity": c.Severity, "description": c.Description, "rationale": c.Rationale, "impact": c.Impact, "mitre_attack": c.MitreAttack, "auto_remediation": actionSupported(b.OS, id), "risky": actionRisky(b.OS, id, c.Risky)})
			return string(out)
		}
		return `{"error":"unknown tool"}`
	}
	language := "English"
	if in.Language == "az" {
		language = "Azerbaijani"
	}
	system := "You are a security hardening analyst. Use the tools to inspect one scan, then decide what to do about each failing control. Reply with ONLY a JSON object: " +
		`{"summary": string, "decisions": [{"control_id": string, "action": "remediate"|"review"|"accept", "priority": 1-5, "reason": string}]}. ` +
		"Choose remediate only when get_control reports auto_remediation true; prefer review for risky controls. Write summary and reasons in " + language + "."
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	final, err := s.aiLoop(ctx, prov, system, "Analyze this scan and decide.", runTool)
	if err != nil {
		problem(w, 502, "AI provider request failed")
		return
	}
	start, end := strings.Index(final, "{"), strings.LastIndex(final, "}")
	var parsed struct {
		Summary   string `json:"summary"`
		Decisions []struct {
			ControlID string `json:"control_id"`
			Action    string `json:"action"`
			Priority  int    `json:"priority"`
			Reason    string `json:"reason"`
		} `json:"decisions"`
	}
	if start < 0 || end <= start || json.Unmarshal([]byte(final[start:end+1]), &parsed) != nil {
		problem(w, 502, "AI provider returned an unusable analysis")
		return
	}
	// Guardrails: unknown controls are dropped and remediation is only advised for supported actions.
	decisions := []map[string]any{}
	seen := map[string]bool{}
	for _, d := range parsed.Decisions {
		if byControl[d.ControlID] == nil || seen[d.ControlID] || len(d.Reason) > 2000 {
			continue
		}
		seen[d.ControlID] = true
		action := d.Action
		if action != "remediate" && action != "review" && action != "accept" {
			action = "review"
		}
		supported := actionSupported(b.OS, d.ControlID)
		if action == "remediate" && !supported {
			action = "review"
		}
		decisions = append(decisions, map[string]any{"control_id": d.ControlID, "title": byControl[d.ControlID].Title, "severity": byControl[d.ControlID].Severity, "action": action, "priority": min(max(d.Priority, 1), 5), "reason": d.Reason, "auto_remediation": supported, "risky": actionRisky(b.OS, d.ControlID, b.Controls[d.ControlID].Risky)})
	}
	sort.SliceStable(decisions, func(i, j int) bool { return decisions[i]["priority"].(int) < decisions[j]["priority"].(int) })
	doc := map[string]any{"scan_id": in.ScanID, "benchmark_id": b.ID, "model": prov.Model, "provider": prov.Name, "summary": parsed.Summary, "decisions": decisions, "created_by": current(r).Username, "created_at": now()}
	if err := s.Store.Put(r.Context(), "ai_analyses", in.ScanID, doc); err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "ai.analyze", in.ScanID, true, "")
	writeJSON(w, 200, doc)
}
