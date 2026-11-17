package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-pdf/fpdf"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gomono"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/sfnt"
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

// ---------- look ----------

type rgb struct{ r, g, b int }

var (
	pdfInk    = rgb{15, 23, 42}
	pdfMuted  = rgb{100, 116, 139}
	pdfLine   = rgb{226, 232, 240}
	pdfSoft   = rgb{248, 250, 252}
	pdfHead   = rgb{241, 245, 249}
	pdfAccent = rgb{37, 99, 235}
	pdfGreen  = rgb{22, 163, 74}
	pdfRed    = rgb{220, 38, 38}
	pdfOrange = rgb{234, 88, 12}
	pdfAmber  = rgb{217, 119, 6}
	pdfGray   = rgb{148, 163, 184}
	pdfMaroon = rgb{153, 27, 27}
)

const (
	pdfMargin  = 14.0
	pdfWidth   = 182.0 // A4 width minus both margins
	pdfBottom  = 18.0
	pdfPageH   = 297.0
	pdfTopNext = 20.0 // where content starts on pages after the first
	pdfMaxText = 1500 // longest command output shown in a card; the CSV and JSON exports keep all of it
)

func statusColor(s string) rgb {
	switch strings.ToLower(s) {
	case "pass", "passed", "applied", "reverted", "restored", "completed", "success", "ok", "done":
		return pdfGreen
	case "fail", "failed":
		return pdfRed
	case "error", "errored", "partial", "completed_with_errors":
		return pdfOrange
	case "running", "queued", "pending", "in_progress", "cancel_requested":
		return pdfAccent
	}
	return pdfGray
}

func severityColor(s string) rgb {
	switch strings.ToLower(s) {
	case "critical":
		return pdfMaroon
	case "high":
		return pdfRed
	case "medium":
		return pdfAmber
	case "low":
		return pdfAccent
	}
	return pdfGray
}

func severityRank(s string) int {
	switch strings.ToLower(s) {
	case "critical":
		return 0
	case "high":
		return 1
	case "medium":
		return 2
	case "low":
		return 3
	}
	return 4
}

func rateColor(pct int) rgb {
	switch {
	case pct >= 80:
		return pdfGreen
	case pct >= 50:
		return pdfAmber
	}
	return pdfRed
}

// tint mixes a colour with white; 0.88 gives the light pill background.
func tint(c rgb, f float64) rgb {
	m := func(v int) int { return v + int(float64(255-v)*f) }
	return rgb{m(c.r), m(c.g), m(c.b)}
}

// ---------- values ----------

func pdfStr(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "yes"
		}
		return "no"
	case float64:
		if x == math.Trunc(x) && math.Abs(x) < 1e15 {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case json.Number:
		return x.String()
	}
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(data)
}

func pdfNum(v any) int {
	n, _ := strconv.ParseFloat(pdfStr(v), 64)
	return int(math.Round(n))
}

func pdfParse(v any) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339Nano, pdfStr(v))
	return t, err == nil
}

// pdfTime shows a stored UTC timestamp as Baku time, e.g. 17 Nov 2026, 12:56:59.
func pdfTime(v any) string {
	if t, ok := pdfParse(v); ok {
		return t.In(bakuTime).Format("02 Jan 2006, 15:04:05")
	}
	return pdfStr(v)
}

func pdfDuration(start, end any) string {
	a, ok1 := pdfParse(start)
	b, ok2 := pdfParse(end)
	if !ok1 || !ok2 || b.Before(a) {
		return ""
	}
	return b.Sub(a).Round(time.Second).String()
}

func pdfMode(v any) string {
	switch pdfStr(v) {
	case "pam":
		return "Agentless (PAM)"
	case "agent", "":
		return "Agent"
	}
	return pdfStr(v)
}

func pdfCap(s string) string {
	s = strings.TrimRight(s, " \t\r\n")
	if utf8.RuneCountInString(s) <= pdfMaxText {
		return s
	}
	r := []rune(s)
	return string(r[:pdfMaxText]) + fmt.Sprintf("\n... %d more characters in the CSV and JSON exports", len(r)-pdfMaxText)
}

func pct(part, whole int) int {
	if whole == 0 {
		return 0
	}
	return int(math.Round(100 * float64(part) / float64(whole)))
}

// ---------- renderer ----------

type pdfDoc struct {
	pdf    *fpdf.Fpdf
	font   *sfnt.Font
	fb     sfnt.Buffer
	budget int
	err    error
}

type pdfCard struct {
	label, value, note string
	color              rgb
}

type pdfSeg struct {
	label string
	n     int
	color rgb
}

type pdfCol struct {
	title string
	w     float64
	align string
}

// pdfCell is one table cell: plain text, a coloured pill, or a percentage bar (bar >= 0).
type pdfCell struct {
	text  string
	pill  *rgb
	bar   int
	color *rgb
}

func txt(s string) pdfCell { return pdfCell{text: s, bar: -1} }
func pillCell(s string, c rgb) pdfCell {
	return pdfCell{text: s, pill: &c, bar: -1}
}
func barCell(p int) pdfCell { return pdfCell{bar: p} }
func numCell(n int, c rgb) pdfCell {
	if n == 0 {
		return pdfCell{text: "0", bar: -1}
	}
	return pdfCell{text: strconv.Itoa(n), color: &c, bar: -1}
}

type pdfField struct {
	label, value string
	mono         bool
}

func newPDFDoc(kind, name string) (*pdfDoc, error) {
	font, err := sfnt.Parse(goregular.TTF)
	if err != nil {
		return nil, errors.New("embedded PDF font is unavailable")
	}
	p := fpdf.New("P", "mm", "A4", "")
	p.SetMargins(pdfMargin, pdfTopNext, pdfMargin)
	p.SetAutoPageBreak(true, pdfBottom)
	p.AddUTF8FontFromBytes("Go", "", goregular.TTF)
	p.AddUTF8FontFromBytes("Go", "B", gobold.TTF)
	p.AddUTF8FontFromBytes("Mono", "", gomono.TTF)
	p.SetTitle("Wearden "+strings.ToLower(kind), true)
	p.SetAuthor("Wearden", true)
	p.AliasNbPages("")
	d := &pdfDoc{pdf: p, font: font}
	running := d.s("WEARDEN   " + kind + "   " + name)
	footer := d.s("Wearden " + strings.ToLower(kind) + " · generated " + pdfTime(now()) + " (Asia/Baku)")
	p.SetHeaderFuncMode(func() {
		if p.PageNo() == 1 {
			return
		}
		p.SetFont("Go", "B", 7.5)
		d.textColor(pdfMuted)
		p.SetXY(pdfMargin, 9)
		p.CellFormat(pdfWidth, 5, d.fit(running, pdfWidth), "", 0, "L", false, 0, "")
		d.drawColor(pdfLine)
		p.SetLineWidth(0.3)
		p.Line(pdfMargin, 15, pdfMargin+pdfWidth, 15)
		p.SetY(pdfTopNext)
	}, false)
	p.SetFooterFunc(func() {
		p.SetY(-12)
		p.SetFont("Go", "", 7.5)
		d.textColor(pdfMuted)
		p.CellFormat(pdfWidth*0.75, 5, footer, "", 0, "L", false, 0, "")
		p.CellFormat(pdfWidth*0.25, 5, fmt.Sprintf("Page %d of {nb}", p.PageNo()), "", 0, "R", false, 0, "")
	})
	p.AddPage()
	return d, d.err
}

func (d *pdfDoc) fillColor(c rgb)                    { d.pdf.SetFillColor(c.r, c.g, c.b) }
func (d *pdfDoc) drawColor(c rgb)                    { d.pdf.SetDrawColor(c.r, c.g, c.b) }
func (d *pdfDoc) textColor(c rgb)                    { d.pdf.SetTextColor(c.r, c.g, c.b) }
func (d *pdfDoc) setFont(style string, size float64) { d.pdf.SetFont("Go", style, size) }

// s makes any value printable: characters the embedded font cannot draw are shown as \u{XXXX}.
func (d *pdfDoc) s(v any) string {
	raw := pdfStr(v)
	if d.err != nil {
		return ""
	}
	if len(raw) > 64*1024 || !utf8.ValidString(raw) {
		d.err = errPDFTooLarge
		return ""
	}
	var out strings.Builder
	for _, r := range raw {
		if r == '\n' || r == '\t' {
			out.WriteRune(r)
			continue
		}
		glyph, err := d.font.GlyphIndex(&d.fb, r)
		if err != nil {
			d.err = errors.New("cannot inspect embedded font")
			return ""
		}
		if glyph == 0 || unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			fmt.Fprintf(&out, "\\u{%X}", r)
		} else {
			out.WriteRune(r)
		}
	}
	d.budget += out.Len()
	if d.budget > 4*1024*1024 {
		d.err = errPDFTooLarge
		return ""
	}
	return out.String()
}

// fit shortens one line of text with "..." until it fits w millimetres in the current font.
func (d *pdfDoc) fit(s string, w float64) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r", " "), "\n", " ")
	if d.pdf.GetStringWidth(s) <= w {
		return s
	}
	r := []rune(s)
	for len(r) > 0 && d.pdf.GetStringWidth(string(r)+"...") > w {
		r = r[:len(r)-1]
	}
	return string(r) + "..."
}

// need starts a new page when fewer than h millimetres are left.
func (d *pdfDoc) need(h float64) {
	if d.pdf.GetY()+h > pdfPageH-pdfBottom {
		d.pdf.AddPage()
	}
	if d.pdf.PageNo() > 250 {
		d.err = errPDFTooLarge
	}
}

// pill draws a rounded status label at x,y and returns its width.
func (d *pdfDoc) pill(label string, c rgb, x, y float64) float64 {
	p := d.pdf
	label = strings.ToUpper(strings.ReplaceAll(label, "_", " "))
	d.setFont("B", 6.8)
	w := p.GetStringWidth(label) + 4.4
	d.fillColor(tint(c, 0.86))
	p.RoundedRect(x, y, w, 4.6, 2.3, "1234", "F")
	d.textColor(c)
	p.SetXY(x, y)
	p.CellFormat(w, 4.6, label, "", 0, "C", false, 0, "")
	return w
}

func (d *pdfDoc) pillWidth(label string) float64 {
	d.setFont("B", 6.8)
	return d.pdf.GetStringWidth(strings.ToUpper(strings.ReplaceAll(label, "_", " "))) + 4.4
}

func (d *pdfDoc) banner(kind, name, status, subtitle string) {
	p := d.pdf
	d.fillColor(pdfInk)
	p.Rect(0, 0, 210, 46, "F")
	d.fillColor(pdfAccent)
	p.Rect(0, 46, 210, 1.4, "F")
	d.setFont("B", 8.5)
	d.textColor(pdfGray)
	p.SetXY(pdfMargin, 10)
	p.CellFormat(60, 5, "W E A R D E N", "", 0, "L", false, 0, "")
	d.setFont("B", 21)
	d.textColor(rgb{255, 255, 255})
	p.SetXY(pdfMargin, 16)
	p.CellFormat(150, 10, d.s(kind), "", 0, "L", false, 0, "")
	d.setFont("", 11.5)
	d.textColor(rgb{203, 213, 225})
	p.SetXY(pdfMargin, 27)
	p.CellFormat(150, 6, d.fit(d.s(name), 150), "", 0, "L", false, 0, "")
	d.setFont("", 8)
	d.textColor(pdfGray)
	p.SetXY(pdfMargin, 35)
	p.CellFormat(170, 5, d.fit(d.s(subtitle), 170), "", 0, "L", false, 0, "")
	if status != "" {
		w := d.pillWidth(status)
		d.pill(status, statusColor(status), pdfMargin+pdfWidth-w, 11)
	}
	p.SetY(55)
}

// meta prints label and value pairs in two columns; empty values are left out.
func (d *pdfDoc) meta(items [][2]string) {
	p := d.pdf
	shown := [][2]string{}
	for _, it := range items {
		if strings.TrimSpace(it[1]) != "" {
			shown = append(shown, it)
		}
	}
	colW := pdfWidth / 2
	for i := 0; i < len(shown); i += 2 {
		d.need(12)
		y := p.GetY()
		end := y
		for j := 0; j < 2 && i+j < len(shown); j++ {
			x := pdfMargin + float64(j)*colW
			d.setFont("B", 7)
			d.textColor(pdfMuted)
			p.SetXY(x, y)
			p.CellFormat(colW-4, 4, strings.ToUpper(shown[i+j][0]), "", 0, "L", false, 0, "")
			d.setFont("", 9.5)
			d.textColor(pdfInk)
			p.SetXY(x, y+4)
			p.MultiCell(colW-6, 4.8, d.s(shown[i+j][1]), "", "L", false)
			end = math.Max(end, p.GetY())
		}
		p.SetY(end + 2.5)
	}
	d.rule()
}

func (d *pdfDoc) rule() {
	d.drawColor(pdfLine)
	d.pdf.SetLineWidth(0.3)
	y := d.pdf.GetY() + 1
	d.pdf.Line(pdfMargin, y, pdfMargin+pdfWidth, y)
	d.pdf.SetY(y + 5)
}

func (d *pdfDoc) cards(cards []pdfCard) {
	p := d.pdf
	const gap, h = 3.0, 25.0
	w := (pdfWidth - gap*float64(len(cards)-1)) / float64(len(cards))
	d.need(h + 6)
	y := p.GetY()
	for i, c := range cards {
		x := pdfMargin + float64(i)*(w+gap)
		d.fillColor(pdfSoft)
		d.drawColor(pdfLine)
		p.SetLineWidth(0.3)
		p.RoundedRect(x, y, w, h, 2, "1234", "FD")
		d.fillColor(c.color)
		p.Rect(x, y+4, 1.3, h-8, "F")
		d.setFont("B", 19)
		d.textColor(c.color)
		p.SetXY(x+5, y+4)
		p.CellFormat(w-7, 9, c.value, "", 0, "L", false, 0, "")
		d.setFont("B", 7.8)
		d.textColor(pdfInk)
		p.SetXY(x+5, y+14)
		p.CellFormat(w-7, 4, d.fit(c.label, w-7), "", 0, "L", false, 0, "")
		if c.note != "" {
			d.setFont("", 6.8)
			d.textColor(pdfMuted)
			p.SetXY(x+5, y+18.5)
			p.CellFormat(w-7, 4, d.fit(c.note, w-7), "", 0, "L", false, 0, "")
		}
	}
	p.SetY(y + h + 7)
}

// bar draws one stacked bar of all segments with a legend below it.
func (d *pdfDoc) bar(segs []pdfSeg) {
	p := d.pdf
	total := 0
	for _, s := range segs {
		total += s.n
	}
	if total == 0 {
		return
	}
	d.need(18)
	y := p.GetY()
	d.fillColor(pdfLine)
	p.RoundedRect(pdfMargin, y, pdfWidth, 5, 2.5, "1234", "F")
	x := pdfMargin
	for _, s := range segs {
		if s.n == 0 {
			continue
		}
		w := pdfWidth * float64(s.n) / float64(total)
		d.fillColor(s.color)
		p.Rect(x, y, w, 5, "F")
		x += w
	}
	x = pdfMargin
	d.setFont("", 8)
	for _, s := range segs {
		if s.n == 0 {
			continue
		}
		label := fmt.Sprintf("%s  %d (%d%%)", s.label, s.n, pct(s.n, total))
		d.fillColor(s.color)
		p.RoundedRect(x, y+8.2, 2.6, 2.6, 0.6, "1234", "F")
		d.textColor(pdfInk)
		p.SetXY(x+3.6, y+7.5)
		lw := p.GetStringWidth(label) + 1
		p.CellFormat(lw, 4, label, "", 0, "L", false, 0, "")
		x += lw + 3.6 + 6
	}
	p.SetY(y + 17)
}

func (d *pdfDoc) section(title, note string) {
	p := d.pdf
	d.need(26)
	p.Ln(1)
	d.setFont("B", 13)
	d.textColor(pdfInk)
	p.SetX(pdfMargin)
	p.CellFormat(pdfWidth, 7, title, "", 1, "L", false, 0, "")
	d.fillColor(pdfAccent)
	p.Rect(pdfMargin, p.GetY()+0.3, 12, 0.9, "F")
	p.SetY(p.GetY() + 3)
	if note != "" {
		d.setFont("", 8)
		d.textColor(pdfMuted)
		p.SetX(pdfMargin)
		p.MultiCell(pdfWidth, 4.2, note, "", "L", false)
		p.SetY(p.GetY() + 2)
	}
	p.SetY(p.GetY() + 1)
}

func (d *pdfDoc) table(cols []pdfCol, rows [][]pdfCell) {
	p := d.pdf
	const rowH = 7.0
	header := func() {
		y := p.GetY()
		d.fillColor(pdfHead)
		p.Rect(pdfMargin, y, pdfWidth, rowH, "F")
		d.setFont("B", 6.8)
		d.textColor(pdfMuted)
		x := pdfMargin
		for _, c := range cols {
			p.SetXY(x, y)
			p.CellFormat(c.w, rowH, " "+strings.ToUpper(c.title)+" ", "", 0, c.align, false, 0, "")
			x += c.w
		}
		p.SetY(y + rowH)
	}
	d.need(rowH * 3)
	header()
	for i, row := range rows {
		if d.err != nil {
			return
		}
		if p.GetY()+rowH > pdfPageH-pdfBottom {
			d.need(rowH * 2)
			header()
		}
		y := p.GetY()
		if i%2 == 1 {
			d.fillColor(pdfSoft)
			p.Rect(pdfMargin, y, pdfWidth, rowH, "F")
		}
		x := pdfMargin
		for j, c := range cols {
			cell := row[j]
			switch {
			case cell.pill != nil && cell.text != "":
				w := d.pillWidth(cell.text)
				px := x + 1.5
				if c.align == "C" {
					px = x + (c.w-w)/2
				}
				d.pill(cell.text, *cell.pill, px, y+1.2)
			case cell.bar >= 0:
				bw := c.w - 15
				col := rateColor(cell.bar)
				d.fillColor(pdfLine)
				p.RoundedRect(x+1.5, y+2.75, bw, 1.6, 0.8, "1234", "F")
				if cell.bar > 0 {
					d.fillColor(col)
					p.RoundedRect(x+1.5, y+2.75, math.Max(1.6, bw*float64(cell.bar)/100), 1.6, 0.8, "1234", "F")
				}
				d.setFont("B", 7.8)
				d.textColor(col)
				p.SetXY(x+bw+1.5, y)
				p.CellFormat(12, rowH, fmt.Sprintf("%d%%", cell.bar), "", 0, "R", false, 0, "")
			default:
				d.setFont("", 8.2)
				d.textColor(pdfInk)
				if cell.color != nil {
					d.setFont("B", 8.2)
					d.textColor(*cell.color)
				}
				p.SetXY(x, y)
				p.CellFormat(c.w, rowH, " "+d.fit(d.s(cell.text), c.w-3)+" ", "", 0, c.align, false, 0, "")
			}
			x += c.w
		}
		p.SetY(y + rowH)
	}
	d.drawColor(pdfLine)
	p.SetLineWidth(0.3)
	p.Line(pdfMargin, p.GetY(), pdfMargin+pdfWidth, p.GetY())
	p.SetY(p.GetY() + 6)
}

// card prints one finding or change: a heading with pills, a subtitle line and labelled fields,
// with a coloured strip on the left. Empty fields are left out; long cards continue on the next page.
func (d *pdfDoc) card(head, title string, pills []pdfSeg, sub string, fields []pdfField, color rgb) {
	p := d.pdf
	if d.err != nil {
		return
	}
	d.need(40) // keep the heading together with its first field
	const inset = 5.0
	x0, inner := pdfMargin+inset, pdfWidth-inset
	page, y0 := p.PageNo(), p.GetY()
	d.setFont("B", 10.5)
	d.textColor(pdfInk)
	head = d.s(head)
	hw := p.GetStringWidth(head) + 3
	p.SetXY(x0, y0)
	p.CellFormat(hw, 6, head, "", 0, "L", false, 0, "")
	px := x0 + hw
	for _, pl := range pills {
		if pl.label == "" {
			continue
		}
		px += d.pill(pl.label, pl.color, px, y0+0.7) + 1.5
	}
	p.SetXY(x0, y0+6.5)
	if title != "" {
		d.setFont("B", 9.5)
		d.textColor(pdfInk)
		p.MultiCell(inner, 4.8, d.s(title), "", "L", false)
	}
	if sub != "" {
		d.setFont("", 7.8)
		d.textColor(pdfMuted)
		p.SetX(x0)
		p.MultiCell(inner, 4.2, d.s(sub), "", "L", false)
	}
	for _, f := range fields {
		v := strings.TrimSpace(f.value)
		if v == "" {
			continue
		}
		p.SetY(p.GetY() + 1.6)
		d.need(10)
		d.setFont("B", 6.8)
		d.textColor(pdfMuted)
		p.SetX(x0)
		p.CellFormat(inner, 4, strings.ToUpper(f.label), "", 1, "L", false, 0, "")
		p.SetX(x0)
		if f.mono {
			p.SetFont("Mono", "", 7.6)
			d.textColor(pdfInk)
			d.fillColor(pdfHead)
			p.MultiCell(inner, 3.9, d.s(pdfCap(f.value)), "", "L", true)
		} else {
			d.setFont("", 8.8)
			d.textColor(pdfInk)
			p.MultiCell(inner, 4.5, d.s(v), "", "L", false)
		}
	}
	y1 := p.GetY() + 1.5
	d.fillColor(color)
	// The strip covers every page the card runs across.
	last := p.PageNo()
	for pg := page; pg <= last; pg++ {
		top, bottom := pdfTopNext, pdfPageH-pdfBottom
		if pg == page {
			top = y0
		}
		if pg == last {
			bottom = y1
		}
		p.SetPage(pg)
		d.fillColor(color)
		p.Rect(pdfMargin, top, 1.4, bottom-top, "F")
	}
	p.SetPage(last)
	p.SetY(y1)
	d.drawColor(pdfLine)
	p.SetLineWidth(0.25)
	p.Line(pdfMargin, y1+2.5, pdfMargin+pdfWidth, y1+2.5)
	p.SetY(y1 + 6)
}

func (d *pdfDoc) output() ([]byte, error) {
	if d.err != nil {
		return nil, d.err
	}
	var out pdfBuffer
	if err := d.pdf.Output(io.Writer(&out)); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// statusSegs counts rows by key in first-seen order, coloured by status.
func statusSegs(rows []map[string]any, key string) []pdfSeg {
	idx := map[string]int{}
	segs := []pdfSeg{}
	for _, r := range rows {
		st := strings.ToLower(pdfStr(r[key]))
		if st == "" {
			continue
		}
		if i, ok := idx[st]; ok {
			segs[i].n++
			continue
		}
		idx[st] = len(segs)
		word := []rune(strings.ReplaceAll(st, "_", " "))
		segs = append(segs, pdfSeg{label: strings.ToUpper(string(word[:1])) + string(word[1:]), n: 1, color: statusColor(st)})
	}
	return segs
}

func countBy(segs []pdfSeg, c rgb) int {
	n := 0
	for _, s := range segs {
		if s.color == c {
			n += s.n
		}
	}
	return n
}

// ---------- reports ----------

func scanPDF(doc map[string]any) ([]byte, error) {
	hosts, rows := featureMaps(doc["hosts"]), featureMaps(doc["results"])
	if len(hosts) > 1000 || len(rows) > 5000 {
		return nil, errPDFTooLarge
	}
	d, err := newPDFDoc("Security scan report", pdfStr(doc["name"]))
	if err != nil {
		return nil, err
	}
	passed, failed, errored := 0, 0, 0
	for _, r := range rows {
		switch statusColor(pdfStr(r["status"])) {
		case pdfGreen:
			passed++
		case pdfRed:
			failed++
		case pdfOrange:
			errored++
		}
	}
	other := len(rows) - passed - failed - errored
	score := pct(passed, passed+failed)
	d.banner("Security scan report", pdfStr(doc["name"]), pdfStr(doc["status"]), "Benchmark "+pdfStr(doc["benchmark_id"])+"   ·   All times are Asia/Baku (UTC+4)")
	d.meta([][2]string{
		{"Benchmark", pdfStr(doc["benchmark_id"])}, {"Profile", pdfStr(doc["profile_name"])},
		{"Mode", pdfMode(doc["mode"])}, {"Created by", pdfStr(doc["created_by"])},
		{"Started", pdfTime(doc["started_at"])}, {"Finished", pdfTime(doc["finished_at"])},
		{"Duration", pdfDuration(doc["started_at"], doc["finished_at"])}, {"Checks", fmt.Sprintf("%d of %d done", pdfNum(doc["done_checks"]), pdfNum(doc["total_checks"]))},
		{"Hosts", strconv.Itoa(len(hosts))}, {"Report ID", pdfStr(doc["id"])},
		{"Message", pdfStr(doc["message"])},
	})
	d.cards([]pdfCard{
		{"Compliance score", fmt.Sprintf("%d%%", score), "passed of pass + fail", rateColor(score)},
		{"Passed", strconv.Itoa(passed), "checks", pdfGreen},
		{"Failed", strconv.Itoa(failed), "checks", pdfRed},
		{"Errors", strconv.Itoa(errored), "could not be checked", pdfOrange},
		{"Other", strconv.Itoa(other), "not applicable, skipped", pdfGray},
	})
	d.bar([]pdfSeg{{"Passed", passed, pdfGreen}, {"Failed", failed, pdfRed}, {"Errors", errored, pdfOrange}, {"Other", other, pdfGray}})

	type tally struct{ total, pass, fail int }
	bySev, byCat := map[string]*tally{}, map[string]*tally{}
	cats := []string{}
	for _, r := range rows {
		sev, cat := strings.ToLower(pdfStr(r["severity"])), pdfStr(r["category"])
		if bySev[sev] == nil {
			bySev[sev] = &tally{}
		}
		if byCat[cat] == nil {
			byCat[cat] = &tally{}
			cats = append(cats, cat)
		}
		for _, t := range []*tally{bySev[sev], byCat[cat]} {
			t.total++
			switch statusColor(pdfStr(r["status"])) {
			case pdfGreen:
				t.pass++
			case pdfRed:
				t.fail++
			}
		}
	}
	sevs := make([]string, 0, len(bySev))
	for s := range bySev {
		sevs = append(sevs, s)
	}
	sort.Slice(sevs, func(i, j int) bool { return severityRank(sevs[i]) < severityRank(sevs[j]) })
	d.section("Results by severity", "Pass rate counts passed checks against passed and failed ones.")
	sevRows := [][]pdfCell{}
	for _, s := range sevs {
		t := bySev[s]
		label := s
		if label == "" {
			label = "unrated"
		}
		sevRows = append(sevRows, []pdfCell{pillCell(label, severityColor(s)), txt(strconv.Itoa(t.total)), numCell(t.pass, pdfGreen), numCell(t.fail, pdfRed), barCell(pct(t.pass, t.pass+t.fail))})
	}
	d.table([]pdfCol{{"Severity", 34, "L"}, {"Checks", 24, "R"}, {"Passed", 24, "R"}, {"Failed", 24, "R"}, {"Pass rate", 76, "L"}}, sevRows)

	if len(hosts) > 0 {
		d.section("Hosts", "")
		hostRows := [][]pdfCell{}
		for _, h := range hosts {
			hp, hf := pdfNum(h["passed"]), pdfNum(h["failed"])
			hostRows = append(hostRows, []pdfCell{txt(pdfStr(h["asset_name"])), txt(pdfStr(h["host"])), txt(pdfStr(h["os_detected"])), numCell(hp, pdfGreen), numCell(hf, pdfRed), numCell(pdfNum(h["errored"]), pdfOrange), barCell(pct(hp, hp+hf))})
		}
		d.table([]pdfCol{{"Asset", 34, "L"}, {"Address", 28, "L"}, {"Operating system", 40, "L"}, {"Pass", 14, "R"}, {"Fail", 14, "R"}, {"Err", 14, "R"}, {"Score", 38, "L"}}, hostRows)
	}

	d.section("Results by category", "")
	sort.Slice(cats, func(i, j int) bool {
		a, b := byCat[cats[i]], byCat[cats[j]]
		if a.fail != b.fail {
			return a.fail > b.fail
		}
		return cats[i] < cats[j]
	})
	catRows := [][]pdfCell{}
	for _, c := range cats {
		t := byCat[c]
		catRows = append(catRows, []pdfCell{txt(c), txt(strconv.Itoa(t.total)), numCell(t.pass, pdfGreen), numCell(t.fail, pdfRed), barCell(pct(t.pass, t.pass+t.fail))})
	}
	d.table([]pdfCol{{"Category", 82, "L"}, {"Checks", 18, "R"}, {"Passed", 18, "R"}, {"Failed", 18, "R"}, {"Pass rate", 46, "L"}}, catRows)

	attention, rest := []map[string]any{}, []map[string]any{}
	for _, r := range rows {
		if c := statusColor(pdfStr(r["status"])); c == pdfRed || c == pdfOrange {
			attention = append(attention, r)
		} else {
			rest = append(rest, r)
		}
	}
	bySeverity := func(list []map[string]any) {
		sort.SliceStable(list, func(i, j int) bool {
			a, b := severityRank(pdfStr(list[i]["severity"])), severityRank(pdfStr(list[j]["severity"]))
			if a != b {
				return a < b
			}
			return pdfStr(list[i]["control_id"]) < pdfStr(list[j]["control_id"])
		})
	}
	bySeverity(attention)
	bySeverity(rest)
	if len(attention) > 0 {
		d.section(fmt.Sprintf("Checks that need attention (%d)", len(attention)), "Failed checks and checks that returned an error, most severe first.")
		for _, r := range attention {
			sub := []string{}
			for _, part := range []string{pdfStr(r["category"]), pdfStr(r["asset_name"]), pdfTime(r["checked_at"])} {
				if part != "" {
					sub = append(sub, part)
				}
			}
			if ms := pdfNum(r["duration_ms"]); ms > 0 {
				sub = append(sub, fmt.Sprintf("%.1f s", float64(ms)/1000))
			}
			raw := strings.TrimSpace(pdfStr(r["raw_output"]))
			if raw == strings.TrimSpace(pdfStr(r["actual"])) {
				raw = ""
			}
			st, sev := pdfStr(r["status"]), pdfStr(r["severity"])
			d.card(pdfStr(r["control_id"]), pdfStr(r["title"]), []pdfSeg{{label: st, color: statusColor(st)}, {label: sev, color: severityColor(sev)}}, strings.Join(sub, "   ·   "), []pdfField{
				{"Expected", pdfStr(r["expected"]), true},
				{"Actual", pdfStr(r["actual"]), true},
				{"Message", pdfStr(r["message"]), false},
				{"Command output", raw, true},
			}, statusColor(st))
		}
	}
	if len(rest) > 0 {
		d.section(fmt.Sprintf("Passed and other checks (%d)", len(rest)), "")
		restRows := [][]pdfCell{}
		for _, r := range rest {
			st, sev := pdfStr(r["status"]), pdfStr(r["severity"])
			restRows = append(restRows, []pdfCell{txt(pdfStr(r["control_id"])), txt(pdfStr(r["title"])), pillCell(sev, severityColor(sev)), pillCell(st, statusColor(st))})
		}
		d.table([]pdfCol{{"Control", 28, "L"}, {"Title", 106, "L"}, {"Severity", 24, "L"}, {"Status", 24, "L"}}, restRows)
	}
	return d.output()
}

// changeCard prints one hardening change; rollbackFirst puts the rollback result before the remediation.
func (d *pdfDoc) changeCard(c map[string]any, rollbackFirst bool) {
	st, sev, rb := pdfStr(c["status"]), pdfStr(c["severity"]), pdfStr(c["rollback_status"])
	pills := []pdfSeg{{label: st, color: statusColor(st)}, {label: sev, color: severityColor(sev)}}
	if rb != "" {
		pills = append(pills, pdfSeg{label: "rollback " + rb, color: statusColor(rb)})
	}
	if c["risky"] == true {
		pills = append(pills, pdfSeg{label: "risky", color: pdfOrange})
	}
	where := pdfStr(c["asset_name"])
	if h := pdfStr(c["host"]); h != "" && h != where {
		where += "  (" + h + ")"
	}
	pair := func(status, value any) string {
		s, v := pdfStr(status), pdfStr(value)
		if s != "" && v != "" {
			return s + "  ·  " + v
		}
		return s + v
	}
	remediation := []pdfField{
		{"Before", pair(c["before_status"], c["before_value"]), true},
		{"After", pair(c["after_status"], c["after_value"]), true},
		{"Message", pdfStr(c["message"]), false},
		{"Remediation output", pdfStr(c["remediation_output"]), true},
	}
	rollback := []pdfField{
		{"Restored value", pair(c["rollback_status"], c["rollback_value"]), true},
		{"Rollback output", pdfStr(c["rollback_output"]), true},
	}
	fields := append(remediation, rollback...)
	color := statusColor(st)
	if rollbackFirst {
		fields = append(rollback, remediation...)
		color = statusColor(rb)
	}
	d.card(pdfStr(c["control_id"]), pdfStr(c["title"]), pills, where, fields, color)
}

func changeTable(d *pdfDoc, changes []map[string]any, valueA, valueB, result string, titles [3]string) {
	rows := [][]pdfCell{}
	for _, c := range changes {
		sev, st := pdfStr(c["severity"]), pdfStr(c[result])
		rows = append(rows, []pdfCell{txt(pdfStr(c["control_id"])), txt(pdfStr(c["asset_name"])), pillCell(sev, severityColor(sev)), txt(pdfStr(c[valueA])), txt(pdfStr(c[valueB])), pillCell(st, statusColor(st))})
	}
	d.table([]pdfCol{{"Control", 26, "L"}, {"Asset", 32, "L"}, {"Severity", 22, "L"}, {titles[0], 36, "L"}, {titles[1], 36, "L"}, {titles[2], 30, "L"}}, rows)
}

// hardeningPDF reports every change of a hardening run: before and after values,
// the outcome and, when it was rolled back, the rollback result.
func hardeningPDF(doc map[string]any) ([]byte, error) {
	changes := featureMaps(doc["changes"])
	if len(changes) > 5000 {
		return nil, errPDFTooLarge
	}
	d, err := newPDFDoc("Hardening report", pdfStr(doc["name"]))
	if err != nil {
		return nil, err
	}
	segs := statusSegs(changes, "status")
	rolledBack := 0
	for _, c := range changes {
		if pdfStr(c["rollback_status"]) != "" {
			rolledBack++
		}
	}
	applied, failed := countBy(segs, pdfGreen), countBy(segs, pdfRed)+countBy(segs, pdfOrange)
	d.banner("Hardening report", pdfStr(doc["name"]), pdfStr(doc["status"]), "Benchmark "+pdfStr(doc["benchmark_id"])+"   ·   All times are Asia/Baku (UTC+4)")
	d.meta([][2]string{
		{"Benchmark", pdfStr(doc["benchmark_id"])}, {"Mode", pdfMode(doc["mode"])},
		{"Source scan", pdfStr(doc["scan_id"])}, {"Risky changes allowed", pdfStr(doc["confirm_risky"])},
		{"Created by", pdfStr(doc["created_by"])}, {"Changes", fmt.Sprintf("%d of %d done", pdfNum(doc["done_changes"]), pdfNum(doc["total_changes"]))},
		{"Started", pdfTime(doc["started_at"])}, {"Finished", pdfTime(doc["finished_at"])},
		{"Duration", pdfDuration(doc["started_at"], doc["finished_at"])}, {"Report ID", pdfStr(doc["id"])},
		{"Message", pdfStr(doc["message"])},
	})
	d.cards([]pdfCard{
		{"Success rate", fmt.Sprintf("%d%%", pct(applied, len(changes))), "applied of all changes", rateColor(pct(applied, len(changes)))},
		{"Changes", strconv.Itoa(len(changes)), "planned", pdfInk},
		{"Applied", strconv.Itoa(applied), "", pdfGreen},
		{"Failed", strconv.Itoa(failed), "backup restored", pdfRed},
		{"Rolled back", strconv.Itoa(rolledBack), "later reverted", pdfAccent},
	})
	d.bar(segs)
	if len(changes) > 0 {
		d.section("Changes", "")
		changeTable(d, changes, "before_status", "after_status", "status", [3]string{"Before", "After", "Result"})
		d.section("Change details", "")
		for _, c := range changes {
			d.changeCard(c, false)
		}
	}
	return d.output()
}

// rollbackPDF reports one rollback process with the changes of its run that were rolled back.
func rollbackPDF(rollback map[string]any, changes []map[string]any) ([]byte, error) {
	if len(changes) > 5000 {
		return nil, errPDFTooLarge
	}
	d, err := newPDFDoc("Rollback report", pdfStr(rollback["name"]))
	if err != nil {
		return nil, err
	}
	segs := statusSegs(changes, "rollback_status")
	reverted, failed := countBy(segs, pdfGreen), countBy(segs, pdfRed)+countBy(segs, pdfOrange)
	d.banner("Rollback report", pdfStr(rollback["name"]), pdfStr(rollback["status"]), "Hardening run "+pdfStr(rollback["run_name"])+"   ·   All times are Asia/Baku (UTC+4)")
	d.meta([][2]string{
		{"Hardening run", pdfStr(rollback["run_name"])}, {"Run ID", pdfStr(rollback["run_id"])},
		{"Mode", pdfMode(rollback["mode"])}, {"Created by", pdfStr(rollback["created_by"])},
		{"Started", pdfTime(rollback["started_at"])}, {"Finished", pdfTime(rollback["finished_at"])},
		{"Duration", pdfDuration(rollback["started_at"], rollback["finished_at"])}, {"Report ID", pdfStr(rollback["id"])},
		{"Message", pdfStr(rollback["message"])},
	})
	d.cards([]pdfCard{
		{"Changes", strconv.Itoa(len(changes)), "rolled back", pdfInk},
		{"Reverted", strconv.Itoa(reverted), "original value restored", pdfGreen},
		{"Failed", strconv.Itoa(failed), "need a manual check", pdfRed},
		{"Other", strconv.Itoa(len(changes) - reverted - failed), "", pdfGray},
	})
	d.bar(segs)
	if len(changes) > 0 {
		d.section("Rolled back changes", "")
		changeTable(d, changes, "after_value", "rollback_value", "rollback_status", [3]string{"Applied value", "Restored value", "Rollback"})
		d.section("Change details", "")
		for _, c := range changes {
			d.changeCard(c, true)
		}
	}
	return d.output()
}
