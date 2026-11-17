package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-pdf/fpdf"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/sfnt"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

var pdfSlots = make(chan struct{}, 2)
var errPDFTooLarge = errors.New("report exceeds PDF limits; use CSV or JSON export")

type pdfBuffer struct{ bytes.Buffer }

func (b *pdfBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 24*1024*1024 {
		return 0, errPDFTooLarge
	}
	return b.Buffer.Write(p)
}

// pdfGroup is a repeated block in a report, such as one host or one finding.
type pdfGroup struct {
	label    string
	numbered bool
	nameKey  string
	keys     []string
	rows     []map[string]any
}

func scanPDF(doc map[string]any) ([]byte, error) {
	hosts, rows := featureMaps(doc["hosts"]), featureMaps(doc["results"])
	if len(hosts) > 1000 || len(rows) > 5000 {
		return nil, errPDFTooLarge
	}
	return reportPDF("Wearden security scan report", doc,
		[]string{"id", "name", "mode", "benchmark_id", "profile_name", "status", "created_at", "started_at", "finished_at", "total_checks", "done_checks", "message"},
		[]pdfGroup{
			{label: "Host", nameKey: "asset_name", keys: []string{"host", "status", "passed", "failed", "errored", "not_applicable", "score", "weighted_score"}, rows: hosts},
			{label: "Finding", numbered: true, nameKey: "control_id", keys: []string{"asset_name", "title", "category", "severity", "status", "actual", "expected", "raw_output", "duration_ms", "message", "checked_at"}, rows: rows},
		})
}

var hardeningChangeKeys = []string{"asset_name", "host", "severity", "risky", "status", "before_status", "before_value", "after_status", "after_value", "rollback_status", "rollback_value", "message", "remediation_output", "rollback_output"}

// hardeningPDF reports every change of a hardening run: before and after values,
// the outcome and, when it was rolled back, the rollback result.
func hardeningPDF(doc map[string]any) ([]byte, error) {
	changes := featureMaps(doc["changes"])
	if len(changes) > 5000 {
		return nil, errPDFTooLarge
	}
	return reportPDF("Wearden hardening report", withChangeCounts(doc, changes, "status"),
		[]string{"id", "name", "mode", "benchmark_id", "scan_id", "status", "confirm_risky", "created_by", "created_at", "started_at", "finished_at", "total_changes", "done_changes", "applied_count", "summary", "message"},
		[]pdfGroup{{label: "Change", numbered: true, nameKey: "control_id", keys: hardeningChangeKeys, rows: changes}})
}

// rollbackPDF reports one rollback process with the changes of its run that were rolled back.
func rollbackPDF(rollback map[string]any, changes []map[string]any) ([]byte, error) {
	if len(changes) > 5000 {
		return nil, errPDFTooLarge
	}
	return reportPDF("Wearden rollback report", withChangeCounts(rollback, changes, "rollback_status"),
		[]string{"id", "name", "mode", "run_id", "run_name", "status", "total", "reverted", "failed", "created_by", "created_at", "started_at", "finished_at", "summary", "message"},
		[]pdfGroup{{label: "Rolled back change", numbered: true, nameKey: "control_id", keys: hardeningChangeKeys, rows: changes}})
}

// withChangeCounts adds a "summary" line such as "applied 4, skipped 2" to a copy of doc.
func withChangeCounts(doc map[string]any, changes []map[string]any, key string) map[string]any {
	counts := map[string]int{}
	order := []string{}
	for _, c := range changes {
		state := text(c[key])
		if state == "" {
			continue
		}
		if counts[state] == 0 {
			order = append(order, state)
		}
		counts[state]++
	}
	parts := []string{}
	for _, state := range order {
		parts = append(parts, fmt.Sprintf("%s %d", strings.ReplaceAll(state, "_", " "), counts[state]))
	}
	out := map[string]any{}
	for k, v := range doc {
		out[k] = v
	}
	out["summary"] = strings.Join(parts, ", ")
	return out
}

func reportPDF(title string, doc map[string]any, headerKeys []string, groups []pdfGroup) ([]byte, error) {
	font, err := sfnt.Parse(goregular.TTF)
	if err != nil {
		return nil, errors.New("embedded PDF font is unavailable")
	}
	var fontBuffer sfnt.Buffer
	budget := 0
	clean := func(value any) (string, error) {
		raw := ""
		if value != nil {
			if s, ok := value.(string); ok {
				raw = s
			} else {
				data, err := json.Marshal(value)
				if err != nil {
					return "", err
				}
				raw = string(data)
			}
		}
		if len(raw) > 64*1024 || !utf8.ValidString(raw) {
			return "", errPDFTooLarge
		}
		var out strings.Builder
		for _, r := range raw {
			if r == '\n' || r == '\t' {
				out.WriteRune(r)
				continue
			}
			glyph, e := font.GlyphIndex(&fontBuffer, r)
			if e != nil {
				return "", errors.New("cannot inspect embedded font")
			}
			if glyph == 0 || unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
				fmt.Fprintf(&out, "\\u{%X}", r)
			} else {
				out.WriteRune(r)
			}
		}
		budget += out.Len()
		if budget > 4*1024*1024 {
			return "", errPDFTooLarge
		}
		return out.String(), nil
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(14, 14, 14)
	pdf.SetAutoPageBreak(true, 16)
	pdf.AddUTF8FontFromBytes("Go", "", goregular.TTF)
	pdf.SetFont("Go", "", 10)
	pdf.SetTitle("Wearden security report", true)
	pdf.SetAuthor("Wearden", true)
	pdf.AddPage()
	line := func(label string, value any) error {
		text, err := clean(value)
		if err != nil {
			return err
		}
		pdf.MultiCell(0, 5, label+text, "", "L", false)
		if pdf.PageNo() > 250 {
			return errPDFTooLarge
		}
		return pdf.Error()
	}
	if err := line("", title); err != nil {
		return nil, err
	}
	for _, key := range headerKeys {
		if _, ok := doc[key]; !ok {
			continue
		}
		if err := line(key+": ", localTime(key, doc[key])); err != nil {
			return nil, err
		}
	}
	for _, group := range groups {
		for i, row := range group.rows {
			pdf.Ln(4)
			label := group.label + ": "
			if group.numbered {
				label = fmt.Sprintf("%s %d: ", group.label, i+1)
			}
			if err := line(label, row[group.nameKey]); err != nil {
				return nil, err
			}
			for _, key := range group.keys {
				if err := line(key+": ", localTime(key, row[key])); err != nil {
					return nil, err
				}
			}
		}
	}
	var output pdfBuffer
	if err := pdf.Output(io.Writer(&output)); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
