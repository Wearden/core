package app

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type featureHostScan struct {
	scan, host map[string]any
	results    []map[string]any
}

func featureCompleted(scans []map[string]any, benchmark string) map[int64][]featureHostScan {
	out := map[int64][]featureHostScan{}
	for _, scan := range scans {
		if text(scan["status"]) != "completed" || (benchmark != "" && text(scan["benchmark_id"]) != benchmark) {
			continue
		}
		for _, host := range featureMaps(scan["hosts"]) {
			id := integer(host["asset_id"])
			if id == 0 {
				continue
			}
			results := []map[string]any{}
			for _, result := range featureMaps(scan["results"]) {
				if integer(result["host_result_id"]) == integer(host["id"]) {
					results = append(results, result)
				}
			}
			out[id] = append(out[id], featureHostScan{scan, host, results})
		}
	}
	return out
}

func (s *Server) featureAssets(ctx context.Context) ([]map[string]any, error) {
	return s.assetList(ctx)
}

func (s *Server) featureDashboard(w http.ResponseWriter, r *http.Request) {
	assets, err := s.featureAssets(r.Context())
	if err != nil {
		s.databaseError(w, err)
		return
	}
	scans, err := s.featureDocuments(r.Context(), "scans")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	runs, err := s.featureDocuments(r.Context(), "hardening")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	latest := featureCompleted(scans, "")
	status := map[string]int{}
	scores := []map[string]any{}
	var totalScore float64
	scored, critical, active, applied := 0, 0, 0, 0
	for _, asset := range assets {
		state := text(asset["status"])
		if state != "online" && state != "offline" && state != "degraded" {
			state = "unknown"
		}
		status[state]++
		history := latest[integer(asset["id"])]
		if len(history) > 0 {
			host := history[len(history)-1]
			scores = append(scores, map[string]any{"asset_id": asset["id"], "asset_name": asset["name"], "score": host.host["score"]})
			if score, ok := featureNumber(host.host["score"]); ok {
				totalScore += score
				scored++
			}
			for _, result := range host.results {
				if text(result["status"]) == "fail" && text(result["severity"]) == "critical" {
					critical++
				}
			}
		}
	}
	for _, scan := range scans {
		if state := text(scan["status"]); state == "running" || state == "queued" || state == "cancel_requested" {
			active++
		}
	}
	for _, run := range runs {
		for _, change := range featureMaps(run["changes"]) {
			if text(change["status"]) == "applied" && text(change["rollback_status"]) != "reverted" {
				applied++
			}
		}
	}
	activity := []map[string]any{}
	rows, err := s.DB.QueryContext(r.Context(), "SELECT created_at,username,action,target,success FROM audit_log ORDER BY created_at DESC,id DESC LIMIT 15")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var at time.Time
		var user, target *string
		var action string
		var success bool
		if err := rows.Scan(&at, &user, &action, &target, &success); err != nil {
			s.databaseError(w, err)
			return
		}
		activity = append(activity, map[string]any{"at": at.UTC().Format(time.RFC3339Nano), "user": user, "action": action, "target": target, "success": success})
	}
	if err := rows.Err(); err != nil {
		s.databaseError(w, err)
		return
	}
	var average any
	if scored > 0 {
		average = totalScore / float64(scored)
	}
	writeJSON(w, 200, map[string]any{"hosts_total": len(assets), "hosts_online": status["online"], "hosts_offline": status["offline"], "hosts_degraded": status["degraded"], "hosts_unknown": status["unknown"], "hosts_scanned": len(scores), "average_score": average, "critical_failed": critical, "scans_total": len(scans), "scans_active": active, "changes_applied": applied, "recent_activity": activity, "scores_by_host": scores})
}

func (s *Server) featureHost(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		problem(w, 400, "Invalid asset id")
		return
	}
	assets, err := s.featureAssets(r.Context())
	if err != nil {
		s.databaseError(w, err)
		return
	}
	var asset map[string]any
	for _, a := range assets {
		if integer(a["id"]) == id {
			asset = a
			break
		}
	}
	if asset == nil {
		problem(w, 404, "Asset not found")
		return
	}
	scans, err := s.featureDocuments(r.Context(), "scans")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	history := featureCompleted(scans, "")[id]
	trend := []map[string]any{}
	categories := map[string]map[string]any{}
	severities := map[string]map[string]any{}
	counts := map[string]int{}
	var latest, before, after any
	for _, item := range history {
		trend = append(trend, featurePoint(item.scan, item.host))
	}
	if len(history) > 0 {
		first, last := history[0], history[len(history)-1]
		before = featurePoint(first.scan, first.host)
		after = featurePoint(last.scan, last.host)
		latest = map[string]any{"scan_id": last.scan["id"], "scan_name": last.scan["name"], "status": last.host["status"], "score": last.host["score"], "weighted_score": last.host["weighted_score"], "passed": last.host["passed"], "failed": last.host["failed"], "errored": last.host["errored"], "not_applicable": last.host["not_applicable"]}
		for _, result := range last.results {
			state := text(result["status"])
			counts[state]++
			category, severity := text(result["category"]), text(result["severity"])
			if categories[category] == nil {
				categories[category] = map[string]any{"category": category, "pass": 0, "fail": 0, "error": 0}
			}
			if severities[severity] == nil {
				severities[severity] = map[string]any{"severity": severity, "pass": 0, "fail": 0}
			}
			if state == "pass" || state == "fail" || state == "error" {
				categories[category][state] = int(integer(categories[category][state])) + 1
			}
			if state == "pass" || state == "fail" {
				severities[severity][state] = int(integer(severities[severity][state])) + 1
			}
		}
	}
	categoryRows, severityRows := []map[string]any{}, []map[string]any{}
	for _, key := range featureSortedKeys(categories) {
		categoryRows = append(categoryRows, categories[key])
	}
	for _, key := range featureSortedKeys(severities) {
		severityRows = append(severityRows, severities[key])
	}
	donut := []map[string]any{}
	for _, state := range []string{"pass", "fail", "error", "not_applicable"} {
		donut = append(donut, map[string]any{"name": state, "value": counts[state]})
	}
	runs, err := s.featureDocuments(r.Context(), "hardening")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	hardening := map[string]any{}
	for _, run := range runs {
		runCounts := map[string]int{}
		for _, change := range featureMaps(run["changes"]) {
			if integer(change["asset_id"]) == id {
				runCounts[text(change["status"])]++
			}
		}
		if len(runCounts) > 0 {
			hardening = map[string]any{"run_id": run["id"], "run_name": run["name"], "counts": runCounts}
		}
	}
	writeJSON(w, 200, map[string]any{"asset": asset, "latest": latest, "donut": donut, "categories": categoryRows, "severities": severityRows, "trend": trend, "before_after": map[string]any{"before": before, "after": after}, "hardening": hardening})
}

func (s *Server) featureHeatmap(w http.ResponseWriter, r *http.Request) {
	bid := r.URL.Query().Get("benchmark_id")
	b := s.Catalog[bid]
	if b == nil {
		problem(w, 404, "Benchmark not found")
		return
	}
	scans, err := s.featureDocuments(r.Context(), "scans")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	latest := featureCompleted(scans, bid)
	categories := map[string]bool{}
	for _, c := range b.Controls {
		categories[c.Category] = true
	}
	rows := []map[string]any{}
	byID := map[string]int64{}
	for id := range latest {
		k := strconv.FormatInt(id, 10)
		byID[k] = id
	}
	for _, key := range featureSortedKeys(byID) {
		history := latest[byID[key]]
		item := history[len(history)-1]
		tallies := map[string][2]int{}
		for _, result := range item.results {
			if !oneOfFeature(text(result["status"]), "pass", "fail") {
				continue
			}
			category := text(result["category"])
			counts := tallies[category]
			counts[1]++
			if text(result["status"]) == "pass" {
				counts[0]++
			}
			tallies[category] = counts
		}
		cells := map[string]any{}
		for category := range categories {
			counts := tallies[category]
			cells[category] = featureRate(counts[0], counts[1])
		}
		rows = append(rows, map[string]any{"asset_id": byID[key], "asset_name": item.host["asset_name"], "cells": cells})
	}
	writeJSON(w, 200, map[string]any{"categories": featureSortedKeys(categories), "rows": rows})
}
func oneOfFeature(s string, values ...string) bool {
	for _, v := range values {
		if s == v {
			return true
		}
	}
	return false
}

func (s *Server) featureAttack(w http.ResponseWriter, r *http.Request) {
	bid := r.URL.Query().Get("benchmark_id")
	b := s.Catalog[bid]
	if b == nil {
		problem(w, 404, "Benchmark not found")
		return
	}
	scans, err := s.featureDocuments(r.Context(), "scans")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	latest := featureCompleted(scans, bid)
	mapping := map[string][]string{}
	for id, c := range b.Controls {
		for _, technique := range c.MitreAttack {
			mapping[technique] = append(mapping[technique], id)
		}
	}
	tally := func(ids []string, first bool) any {
		pass, total := 0, 0
		for _, history := range latest {
			item := history[len(history)-1]
			if first {
				item = history[0]
			}
			states := map[string]string{}
			for _, result := range item.results {
				states[text(result["control_id"])] = text(result["status"])
			}
			for _, id := range ids {
				if oneOfFeature(states[id], "pass", "fail") {
					total++
					if states[id] == "pass" {
						pass++
					}
				}
			}
		}
		return featureRate(pass, total)
	}
	out := []map[string]any{}
	mitigatedBefore, mitigatedAfter := 0, 0
	for _, technique := range featureSortedKeys(mapping) {
		controls := mapping[technique]
		sort.Strings(controls)
		before, after := tally(controls, true), tally(controls, false)
		if v, ok := featureNumber(before); ok && v >= 90 {
			mitigatedBefore++
		}
		if v, ok := featureNumber(after); ok && v >= 90 {
			mitigatedAfter++
		}
		name := attackNames[technique]
		if name == "" {
			name = technique
		}
		out = append(out, map[string]any{"id": technique, "name": name, "controls": controls, "before": before, "after": after})
	}
	writeJSON(w, 200, map[string]any{"techniques": out, "total": len(out), "mitigated_before": mitigatedBefore, "mitigated_after": mitigatedAfter, "threshold": 90, "hosts_assessed": len(latest)})
}

func (s *Server) featureDiff(w http.ResponseWriter, r *http.Request) {
	runs, err := s.featureDocuments(r.Context(), "hardening")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	runID := r.URL.Query().Get("run_id")
	var selected map[string]any
	for _, run := range runs {
		if runID == "" || text(run["id"]) == runID {
			selected = run
		}
	}
	if selected == nil {
		if runID != "" {
			problem(w, 404, "Hardening run not found")
			return
		}
		writeJSON(w, 200, map[string]any{"run_id": nil, "rows": []any{}})
		return
	}
	rows := []map[string]any{}
	for _, change := range featureMaps(selected["changes"]) {
		if asset := r.URL.Query().Get("asset_id"); asset != "" && strconv.FormatInt(integer(change["asset_id"]), 10) != asset {
			continue
		}
		if state := r.URL.Query().Get("status"); state != "" && text(change["status"]) != state {
			continue
		}
		title, category, expected := "", "", ""
		if b := s.Catalog[text(selected["benchmark_id"])]; b != nil {
			if c, ok := b.Controls[text(change["control_id"])]; ok {
				title, category, expected = c.Title, c.Category, c.Audit.Expected
			}
		}
		if q := strings.ToLower(r.URL.Query().Get("q")); q != "" && !strings.Contains(strings.ToLower(title+" "+text(change["control_id"])+" "+text(change["asset_name"])), q) {
			continue
		}
		rows = append(rows, map[string]any{"change_id": change["id"], "asset_name": change["asset_name"], "control_id": change["control_id"], "title": title, "category": category, "severity": change["severity"], "expected": expected, "before": change["before_value"], "after": change["after_value"], "status": change["status"], "rollback_status": change["rollback_status"]})
	}
	writeJSON(w, 200, map[string]any{"run_id": selected["id"], "run_name": selected["name"], "rows": rows})
}
