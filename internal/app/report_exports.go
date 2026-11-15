package app

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

func featureExportFile(value string) (string, string, bool) {
	id, ext, ok := strings.Cut(value, ".")
	if !ok || id == "" || len(id) > 128 || strings.ContainsAny(id, "/\\\r\n\"") {
		return "", "", false
	}
	return id, ext, true
}

func (s *Server) featureScanExport(w http.ResponseWriter, r *http.Request) {
	id, ext, ok := featureExportFile(r.PathValue("file"))
	if !ok || !oneOfFeature(ext, "json", "csv", "pdf") {
		problem(w, 404, "Report format not found")
		return
	}
	doc, err := s.Store.Get(r.Context(), "scans", id)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	if ext == "pdf" {
		select {
		case pdfSlots <- struct{}{}:
			defer func() { <-pdfSlots }()
		default:
			problem(w, 429, "PDF renderer busy; retry later")
			return
		}
		data, err := scanPDF(doc)
		if err != nil {
			if errors.Is(err, errPDFTooLarge) {
				problem(w, 413, err.Error())
			} else {
				problem(w, 500, "PDF rendering failed")
			}
			return
		}
		s.audit(r, "report.scan_export", id, true, "pdf")
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="scan.pdf"`)
		if _, err := w.Write(data); err != nil {
			slog.Error("PDF response write failed")
		}
		return
	}
	s.audit(r, "report.scan_export", id, true, ext)
	if ext == "json" {
		w.Header().Set("Content-Disposition", `attachment; filename="scan.json"`)
		writeJSON(w, 200, doc)
		return
	}
	columns := []string{"asset_name", "control_id", "title", "category", "severity", "status", "actual", "expected", "raw_output", "duration_ms", "message", "checked_at"}
	s.featureCSV(w, "scan.csv", columns, featureMaps(doc["results"]))
}

func (s *Server) featureHardeningExport(w http.ResponseWriter, r *http.Request) {
	id, ext, ok := featureExportFile(r.PathValue("file"))
	if !ok || !oneOfFeature(ext, "csv", "json") {
		problem(w, 404, "Report format not found")
		return
	}
	doc, err := s.Store.Get(r.Context(), "hardening", id)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "report.hardening_export", id, true, ext)
	if ext == "json" {
		w.Header().Set("Content-Disposition", `attachment; filename="hardening.json"`)
		writeJSON(w, 200, doc)
		return
	}
	columns := []string{"asset_name", "host", "control_id", "severity", "status", "before_status", "before_value", "after_status", "after_value", "rollback_status", "rollback_value", "message", "remediation_output", "rollback_output"}
	s.featureCSV(w, "hardening.csv", columns, featureMaps(doc["changes"]))
}

func (s *Server) featureCSV(w http.ResponseWriter, filename string, columns []string, rows []map[string]any) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if err := writer.Write(columns); err != nil {
		problem(w, 500, "CSV encoding failed")
		return
	}
	for _, row := range rows {
		record := make([]string, len(columns))
		for i, column := range columns {
			value := row[column]
			cell := ""
			if value != nil {
				if str, ok := value.(string); ok {
					cell = str
				} else if raw, err := json.Marshal(value); err == nil {
					cell = string(raw)
				} else {
					problem(w, 500, "CSV value encoding failed")
					return
				}
			}
			trimmed := strings.TrimLeft(cell, " \t\r\n")
			if len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0])) {
				cell = "'" + cell
			}
			record[i] = cell
		}
		if err := writer.Write(record); err != nil {
			problem(w, 500, "CSV encoding failed")
			return
		}
	}
	writer.Flush()
	if writer.Error() != nil {
		problem(w, 500, "CSV encoding failed")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(200)
	if _, err := w.Write(buffer.Bytes()); err != nil {
		slog.Warn("report download interrupted")
		return
	}
}
