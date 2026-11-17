package app

import (
	"bytes"
	"strings"
	"testing"
)

// Renders each report with awkward input: missing fields, unknown statuses, emoji, very long output.
func TestReportPDFs(t *testing.T) {
	long := strings.Repeat("line of command output\n", 400)
	results := []any{
		map[string]any{"control_id": "LNX-1", "title": "Ensure something 🚀", "severity": "high", "status": "fail", "category": "Network", "asset_name": "web01", "expected": "1", "actual": "0", "raw_output": long, "checked_at": "2026-11-17T08:55:04.6Z", "duration_ms": 3715.0},
		map[string]any{"control_id": "LNX-2", "title": "Passing check", "severity": "low", "status": "pass", "category": "Network"},
		map[string]any{"control_id": "LNX-3", "status": "weird_state"},
	}
	scan := map[string]any{"id": "1", "name": "Scan ç ə ş", "status": "completed", "mode": "pam", "results": results,
		"hosts":      []any{map[string]any{"asset_name": "web01", "host": "10.0.0.5", "passed": 1.0, "failed": 1.0}},
		"started_at": "2026-11-17T08:50:00Z", "finished_at": "2026-11-17T08:55:10Z"}
	changes := []any{
		map[string]any{"control_id": "LNX-1", "asset_name": "web01", "severity": "medium", "status": "applied", "risky": true, "before_status": "fail", "before_value": "a", "after_status": "pass", "after_value": "b", "rollback_status": "reverted", "rollback_value": "a", "remediation_output": long},
		map[string]any{"control_id": "LNX-2", "status": "failed"},
	}
	run := map[string]any{"id": "2", "name": "Run", "status": "completed", "changes": changes}
	rb := map[string]any{"id": "3", "name": "Rollback", "status": "completed", "run_name": "Run"}
	for name, render := range map[string]func() ([]byte, error){
		"scan":      func() ([]byte, error) { return scanPDF(scan) },
		"hardening": func() ([]byte, error) { return hardeningPDF(run) },
		"rollback":  func() ([]byte, error) { return rollbackPDF(rb, featureMaps(changes)) },
		"empty":     func() ([]byte, error) { return scanPDF(map[string]any{}) },
	} {
		data, err := render()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !bytes.HasPrefix(data, []byte("%PDF")) || bytes.Contains(data, []byte("{nb}")) {
			t.Fatalf("%s: not a finished PDF", name)
		}
	}
}
