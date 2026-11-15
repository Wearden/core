// Package benchmarks loads descriptive legacy controls and native agent manifests.
// Loading never executes the audit or remediation commands in legacy documents.
package benchmarks

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"
)

type BackupItem struct {
	Type string  `json:"type" yaml:"type"`
	Path *string `json:"path" yaml:"path"`
	Name *string `json:"name" yaml:"name"`
}

type Audit struct {
	Type     string `json:"type" yaml:"type"`
	Command  string `json:"command" yaml:"command"`
	Expected string `json:"expected" yaml:"expected"`
	Match    string `json:"match" yaml:"match"`
}

type Remediation struct {
	Backup  []BackupItem `json:"backup" yaml:"backup"`
	Command string       `json:"command" yaml:"command"`
}

type Rollback struct {
	Strategy string  `json:"strategy" yaml:"strategy"`
	Command  *string `json:"command" yaml:"command"`
}

type Control struct {
	ID             string          `json:"id" yaml:"id"`
	CISRef         string          `json:"cis_ref" yaml:"cis_ref"`
	Title          string          `json:"title" yaml:"title"`
	OS             string          `json:"os" yaml:"os"`
	Category       string          `json:"category" yaml:"category"`
	Level          int             `json:"level" yaml:"level"`
	Severity       string          `json:"severity" yaml:"severity"`
	Description    string          `json:"description" yaml:"description"`
	Rationale      string          `json:"rationale" yaml:"rationale"`
	Impact         string          `json:"impact" yaml:"impact"`
	MitreAttack    []string        `json:"mitre_attack" yaml:"mitre_attack"`
	Audit          Audit           `json:"audit" yaml:"audit"`
	Remediation    Remediation     `json:"remediation" yaml:"remediation"`
	Rollback       Rollback        `json:"rollback" yaml:"rollback"`
	RebootRequired bool            `json:"reboot_required" yaml:"reboot_required"`
	Risky          bool            `json:"risky" yaml:"risky"`
	Kind           string          `json:"kind,omitempty" yaml:"-"`
	Target         string          `json:"target,omitempty" yaml:"-"`
	Native         json.RawMessage `json:"native,omitempty" yaml:"-"`
}

type Profile struct {
	ID          string   `json:"id" yaml:"id"`
	Name        string   `json:"name" yaml:"name"`
	Description string   `json:"description" yaml:"description"`
	Builtin     bool     `json:"builtin" yaml:"-"`
	Controls    string   `json:"-" yaml:"controls"`
	ControlIDs  []string `json:"control_ids" yaml:"control_ids"`
}

type Benchmark struct {
	ID       string             `json:"id" yaml:"id"`
	OS       string             `json:"os" yaml:"os"`
	Name     string             `json:"name" yaml:"name"`
	Version  string             `json:"version" yaml:"version"`
	Controls map[string]Control `json:"controls" yaml:"-"`
	Profiles []Profile          `json:"profiles" yaml:"profiles"`
	Native   json.RawMessage    `json:"native,omitempty" yaml:"-"`
	order    []string
}

type Catalog map[string]*Benchmark

func (b *Benchmark) Summary() map[string]any {
	return map[string]any{"id": b.ID, "os": b.OS, "name": b.Name, "version": b.Version, "control_count": len(b.Controls)}
}

// Select returns a fresh slice in file/manifest order, or the explicit profile order.
func (b *Benchmark) Select(profile string) ([]string, error) {
	if profile == "full" {
		return b.allIDs(), nil
	}
	for _, p := range b.Profiles {
		if p.ID == profile {
			return append([]string{}, p.ControlIDs...), nil
		}
	}
	return nil, fmt.Errorf("benchmark %s: unknown profile %q", b.ID, profile)
}

func (b *Benchmark) allIDs() []string {
	if len(b.order) == len(b.Controls) {
		return append([]string{}, b.order...)
	}
	ids := make([]string, 0, len(b.Controls))
	for id := range b.Controls {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Load reads benchmark.yaml directories and recursive native JSON manifests.
// Any invalid catalog entry fails the entire load rather than silently dropping rules.
func Load(root string) (Catalog, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("benchmarks root: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("benchmarks root %s is not a directory", root)
	}
	var legacy, native []string
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == ".git" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Name() == "benchmark.yaml" {
			legacy = append(legacy, path)
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if strings.HasPrefix(filepath.ToSlash(rel), "native/") && strings.EqualFold(filepath.Ext(path), ".json") {
			native = append(native, path)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("discover benchmarks: %w", err)
	}
	sort.Strings(legacy)
	sort.Strings(native)
	catalog := Catalog{}
	add := func(b *Benchmark, path string) error {
		if _, exists := catalog[b.ID]; exists {
			return fmt.Errorf("%s: duplicate benchmark id %s", path, b.ID)
		}
		catalog[b.ID] = b
		return nil
	}
	for _, path := range legacy {
		b, err := loadLegacy(path)
		if err != nil {
			return nil, err
		}
		if err := add(b, path); err != nil {
			return nil, err
		}
	}
	for _, path := range native {
		b, err := loadNative(path, catalog)
		if err != nil {
			return nil, err
		}
		if err := add(b, path); err != nil {
			return nil, err
		}
	}
	if len(catalog) == 0 {
		return nil, errors.New("no benchmarks found")
	}
	return catalog, nil
}

// strictYAML rejects extra keys, multiple YAML documents and absent required keys.
func strictYAML(path string, dest any) (*yaml.Node, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	decoder.KnownFields(true)
	if err := decoder.Decode(dest); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fmt.Errorf("%s: expected one YAML document", path)
	}
	var node yaml.Node
	if err := yaml.Unmarshal(raw, &node); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(node.Content) != 1 || node.Content[0].Kind != yaml.MappingNode {
		return nil, fmt.Errorf("%s: expected YAML mapping", path)
	}
	return node.Content[0], nil
}

func require(node *yaml.Node, keys ...string) error {
	for _, key := range keys {
		if value := mappingValue(node, key); value == nil || value.Tag == "!!null" {
			return fmt.Errorf("missing required field %s", key)
		}
	}
	return nil
}

func mappingValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

var controlID = regexp.MustCompile(`^(LNX|WIN)-[A-Z]{2,4}-\d{3}$`)
var cisRef = regexp.MustCompile(`^\d+(\.\d+)*$`)
var techniqueID = regexp.MustCompile(`^T\d{4}(\.\d{3})?$`)
var benchmarkID = regexp.MustCompile(`^[a-z0-9.-]+$`)
var profileID = regexp.MustCompile(`^[a-z0-9-]+$`)

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func loadLegacy(path string) (*Benchmark, error) {
	b := &Benchmark{Controls: map[string]Control{}}
	node, err := strictYAML(path, b)
	if err != nil {
		return nil, err
	}
	if err := require(node, "id", "os", "name", "version", "profiles"); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if !benchmarkID.MatchString(b.ID) || !oneOf(b.OS, "linux", "windows") || b.Name == "" || b.Version == "" || len(b.Profiles) == 0 {
		return nil, fmt.Errorf("%s: invalid benchmark metadata", path)
	}
	paths, err := filepath.Glob(filepath.Join(filepath.Dir(path), "*.yaml"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	for _, controlPath := range paths {
		if controlPath == path {
			continue
		}
		var group struct {
			Controls []Control `yaml:"controls"`
		}
		node, err := strictYAML(controlPath, &group)
		if err != nil {
			return nil, err
		}
		controlsNode := mappingValue(node, "controls")
		if controlsNode == nil || controlsNode.Kind != yaml.SequenceNode {
			return nil, fmt.Errorf("%s: controls must be a sequence", controlPath)
		}
		for i, control := range group.Controls {
			if err := validateControl(control, controlsNode.Content[i], b.OS); err != nil {
				return nil, fmt.Errorf("%s:%s: %w", controlPath, control.ID, err)
			}
			if _, exists := b.Controls[control.ID]; exists {
				return nil, fmt.Errorf("%s: duplicate control id %s", controlPath, control.ID)
			}
			if control.MitreAttack == nil {
				control.MitreAttack = []string{}
			}
			b.Controls[control.ID] = control
			b.order = append(b.order, control.ID)
		}
	}
	seen := map[string]bool{}
	for i := range b.Profiles {
		p := &b.Profiles[i]
		if !profileID.MatchString(p.ID) || p.Name == "" || len([]rune(p.Name)) > 100 || seen[p.ID] {
			return nil, fmt.Errorf("%s: invalid or duplicate profile %q", path, p.ID)
		}
		seen[p.ID] = true
		if (p.Controls == "") == (p.ControlIDs == nil) || (p.Controls != "" && p.Controls != "all") {
			return nil, fmt.Errorf("%s: profile %s needs exactly one selector: controls: all or control_ids", path, p.ID)
		}
		if p.Controls == "all" {
			p.ControlIDs = b.allIDs()
		}
		for _, id := range p.ControlIDs {
			if _, exists := b.Controls[id]; !exists {
				return nil, fmt.Errorf("%s: profile %s references unknown control %s", path, p.ID, id)
			}
		}
		p.Builtin = true
	}
	return b, nil
}

func validateControl(c Control, node *yaml.Node, expectedOS string) error {
	if err := require(node, "id", "cis_ref", "title", "os", "category", "level", "severity", "description", "rationale", "impact", "audit", "remediation", "rollback", "reboot_required", "risky"); err != nil {
		return err
	}
	prefix := "LNX-"
	if expectedOS == "windows" {
		prefix = "WIN-"
	}
	if !controlID.MatchString(c.ID) || !strings.HasPrefix(c.ID, prefix) || c.OS != expectedOS || !cisRef.MatchString(c.CISRef) {
		return errors.New("invalid control id, CIS reference or OS")
	}
	if c.Title == "" || len([]rune(c.Title)) > 200 || c.Category == "" || len([]rune(c.Category)) > 80 || (c.Level != 1 && c.Level != 2) || !oneOf(c.Severity, "low", "medium", "high", "critical") || c.Description == "" || c.Rationale == "" || c.Impact == "" {
		return errors.New("invalid control metadata")
	}
	for _, id := range c.MitreAttack {
		if !techniqueID.MatchString(id) {
			return fmt.Errorf("invalid MITRE technique %s", id)
		}
	}
	if err := require(mappingValue(node, "audit"), "type", "command", "expected", "match"); err != nil {
		return fmt.Errorf("audit: %w", err)
	}
	if !oneOf(c.Audit.Type, "command", "file_regex", "sysctl", "registry", "secpol", "auditpol", "service") || c.Audit.Command == "" || !oneOf(c.Audit.Match, "equals", "contains", "regex", "not_exists", "numeric_gte", "numeric_lte") {
		return errors.New("invalid audit type, command or matcher")
	}
	if oneOf(c.Audit.Match, "numeric_gte", "numeric_lte") {
		if _, err := strconv.ParseFloat(c.Audit.Expected, 64); err != nil {
			return errors.New("numeric audit matcher requires numeric expected value")
		}
	}
	// Legacy patterns use Python regular expressions; do not reinterpret them as Go RE2.
	if err := require(mappingValue(node, "remediation"), "backup", "command"); err != nil {
		return fmt.Errorf("remediation: %w", err)
	}
	if c.Remediation.Command == "" || len(c.Remediation.Backup) == 0 {
		return errors.New("remediation needs a command and at least one backup")
	}
	for _, backup := range c.Remediation.Backup {
		if !oneOf(backup.Type, "file", "registry", "secedit", "sysctl", "service", "auditpol", "netaccounts", "localuser", "netfirewall", "command") {
			return fmt.Errorf("invalid backup type %q", backup.Type)
		}
	}
	if !oneOf(c.Rollback.Strategy, "restore_backup", "command") || (c.Rollback.Strategy == "command" && (c.Rollback.Command == nil || *c.Rollback.Command == "")) {
		return errors.New("invalid rollback strategy or missing rollback command")
	}
	return nil
}

func loadNative(path string, catalog Catalog) (*Benchmark, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var manifest struct {
		Version        string            `json:"version"`
		BenchmarkID    string            `json:"benchmark_id"`
		RulesetVersion string            `json:"ruleset_version"`
		Rules          []json.RawMessage `json:"rules"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if manifest.Version == "" || !benchmarkID.MatchString(manifest.BenchmarkID) || manifest.RulesetVersion == "" || len(manifest.Rules) == 0 {
		return nil, fmt.Errorf("%s: invalid native manifest metadata or empty rules", path)
	}
	location := strings.ToLower(filepath.ToSlash(path))
	id := strings.ToLower(manifest.BenchmarkID)
	platform := ""
	if strings.Contains(location, "/windows/") || strings.Contains(id, "windows") || strings.Contains(id, "server") {
		platform = "windows"
	} else if strings.Contains(location, "/linux/") || strings.Contains(id, "ubuntu") || strings.Contains(id, "linux") {
		platform = "linux"
	}
	if platform == "" {
		return nil, fmt.Errorf("%s: cannot determine native manifest OS", path)
	}
	b := &Benchmark{ID: manifest.BenchmarkID, OS: platform, Name: manifest.BenchmarkID, Version: manifest.RulesetVersion, Controls: map[string]Control{}, Native: json.RawMessage(raw)}
	legacyIDs := make([]string, 0, len(catalog))
	for id, legacy := range catalog {
		if legacy.OS == platform && len(legacy.Native) == 0 {
			legacyIDs = append(legacyIDs, id)
		}
	}
	sort.Slice(legacyIDs, func(i, j int) bool {
		a := strings.HasPrefix(b.ID, strings.TrimSuffix(legacyIDs[i], "-cis"))
		z := strings.HasPrefix(b.ID, strings.TrimSuffix(legacyIDs[j], "-cis"))
		if a != z {
			return a
		}
		return legacyIDs[i] < legacyIDs[j]
	})
	for _, ruleRaw := range manifest.Rules {
		var rule struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Severity string `json:"severity"`
			Kind     string `json:"kind"`
			Target   string `json:"target"`
		}
		if err := json.Unmarshal(ruleRaw, &rule); err != nil {
			return nil, fmt.Errorf("%s: native rule: %w", path, err)
		}
		if rule.ID == "" || rule.Kind == "" || !oneOf(rule.Severity, "low", "medium", "high", "critical") {
			return nil, fmt.Errorf("%s: invalid native rule %q", path, rule.ID)
		}
		if _, exists := b.Controls[rule.ID]; exists {
			return nil, fmt.Errorf("%s: duplicate native control id %s", path, rule.ID)
		}
		c := Control{ID: rule.ID, Title: rule.Title, OS: platform, Category: rule.Kind, Level: 1, MitreAttack: []string{}, Remediation: Remediation{Backup: []BackupItem{}}}
		for _, legacyID := range legacyIDs {
			if legacy, exists := catalog[legacyID].Controls[rule.ID]; exists {
				c = legacy
				break
			}
		}
		if rule.Title != "" {
			c.Title = rule.Title
		}
		if c.Title == "" {
			c.Title = strings.TrimSpace(rule.Kind + " " + rule.Target)
		}
		c.Severity, c.Kind, c.Target, c.Native = rule.Severity, rule.Kind, rule.Target, ruleRaw
		b.Controls[c.ID] = c
		b.order = append(b.order, c.ID)
	}
	all := b.allIDs()
	quickCount := min(20, len(all))
	b.Profiles = []Profile{
		{ID: "full", Name: "Full", Description: "All native rules in manifest order.", Builtin: true, ControlIDs: all},
		{ID: "quick-20", Name: "Quick 20", Description: "First up to 20 native rules in manifest order.", Builtin: true, ControlIDs: append([]string{}, all[:quickCount]...)},
	}
	return b, nil
}
