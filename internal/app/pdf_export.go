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
func scanPDF(doc map[string]any) ([]byte, error) {
	hosts, rows := featureMaps(doc["hosts"]), featureMaps(doc["results"])
	if len(hosts) > 1000 || len(rows) > 5000 {
		return nil, errPDFTooLarge
	}
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
	if err := line("", "Wearden security scan report"); err != nil {
		return nil, err
	}
	for _, key := range []string{"id", "name", "benchmark_id", "profile_name", "status", "created_at", "started_at", "finished_at", "total_checks", "done_checks", "message"} {
		if err := line(key+": ", doc[key]); err != nil {
			return nil, err
		}
	}
	for _, host := range hosts {
		pdf.Ln(4)
		if err := line("Host: ", host["asset_name"]); err != nil {
			return nil, err
		}
		for _, key := range []string{"host", "status", "passed", "failed", "errored", "not_applicable", "score", "weighted_score"} {
			if err := line(key+": ", host[key]); err != nil {
				return nil, err
			}
		}
	}
	for i, row := range rows {
		pdf.Ln(4)
		if err := line(fmt.Sprintf("Finding %d: ", i+1), row["control_id"]); err != nil {
			return nil, err
		}
		for _, key := range []string{"asset_name", "title", "category", "severity", "status", "actual", "expected", "raw_output", "duration_ms", "message", "checked_at"} {
			if err := line(key+": ", row[key]); err != nil {
				return nil, err
			}
		}
	}
	var output pdfBuffer
	if err := pdf.Output(io.Writer(&output)); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
