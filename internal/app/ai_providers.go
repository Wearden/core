package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/Wearden/core/internal/security"
)

// AI providers. An administrator can add any number of providers: hosted APIs
// (Anthropic, OpenAI) or local and self hosted servers that speak the OpenAI
// compatible chat API (Ollama, LM Studio, vLLM, llama.cpp, OpenRouter and so on).
// API keys are sealed with the vault key and never returned. One provider is the
// default; a request may name another one.
const (
	aiProvidersCollection = "ai_providers"
	aiMetaCollection      = "ai_meta"
	legacyProviderID      = "legacy"
)

type aiProvider struct {
	ID, Name, Kind, BaseURL, Model, Key string
	Headers                             string // extra request headers, one "Name: value" per line
	MaxTokens                           int    // reply limit for one call; 0 means the default
	Enabled                             bool
}

func (p aiProvider) tokens() int {
	if p.MaxTokens > 0 {
		return p.MaxTokens
	}
	return 2000
}

// Headers the provider settings may not override: credentials and framing stay under the platform's control.
var blockedHeaders = map[string]bool{"authorization": true, "x-api-key": true, "host": true, "content-type": true, "content-length": true, "cookie": true, "transfer-encoding": true}

// parseHeaders validates the "Name: value" lines of the extra-headers setting.
func parseHeaders(raw string) (map[string]string, error) {
	out := map[string]string{}
	for _, line := range strings.Split(strings.ReplaceAll(raw, "\r", ""), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name, value, ok := strings.Cut(line, ":")
		name, value = strings.TrimSpace(name), strings.TrimSpace(value)
		if !ok || name == "" || value == "" || len(name) > 64 || len(value) > 256 {
			return nil, errors.New("each header must look like Name: value")
		}
		if strings.ContainsFunc(name, func(r rune) bool {
			return !(r == '-' || r == '_' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z')
		}) {
			return nil, errors.New("header names may only use letters, digits, - and _")
		}
		if blockedHeaders[strings.ToLower(name)] {
			return nil, errors.New("the " + name + " header is set by Wearden and cannot be overridden")
		}
		out[name] = value
		if len(out) > 10 {
			return nil, errors.New("at most 10 extra headers")
		}
	}
	return out, nil
}

// setHeaders applies the identifying User-Agent and the provider's extra headers.
func (p aiProvider) setHeaders(req *http.Request) {
	req.Header.Set("User-Agent", "Wearden-core")
	extra, _ := parseHeaders(p.Headers)
	for k, v := range extra {
		req.Header.Set(k, v)
	}
}

func defaultBaseURL(kind string) string {
	if kind == "anthropic" {
		return "https://api.anthropic.com"
	}
	return "https://api.openai.com/v1"
}

// validProviderURL accepts http and https endpoints (local servers are plain http),
// without credentials, query or fragment, and refuses cloud metadata addresses.
func validProviderURL(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	if host == "metadata.google.internal" {
		return "", false
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLinkLocalUnicast() {
		return "", false
	}
	return strings.TrimRight(u.String(), "/"), true
}

func (s *Server) openKey(doc map[string]any) string {
	sealed, err := base64.StdEncoding.DecodeString(text(doc["sealed_key"]))
	if err != nil || s.Config.VaultKey == "" || len(sealed) == 0 {
		return ""
	}
	plain, err := security.Open(s.Config.VaultKey, sealed)
	if err != nil {
		return ""
	}
	return string(plain)
}

func (s *Server) providerFromDoc(id string, doc map[string]any) aiProvider {
	enabled, ok := doc["enabled"].(bool)
	return aiProvider{ID: id, Name: text(doc["name"]), Kind: text(doc["kind"]), BaseURL: text(doc["base_url"]), Model: text(doc["model"]), Key: s.openKey(doc), Headers: text(doc["headers"]), Enabled: !ok || enabled}
}

// legacyProvider exposes the older Anthropic key and model settings (UI or environment) as a provider.
func (s *Server) legacyProvider(ctx context.Context) (aiProvider, bool) {
	key, _ := s.setting(ctx, "anthropic_api_key")
	model, _ := s.setting(ctx, "anthropic_model")
	if key == "" || model == "" {
		return aiProvider{}, false
	}
	return aiProvider{ID: legacyProviderID, Name: "Anthropic (settings)", Kind: "anthropic", BaseURL: defaultBaseURL("anthropic"), Model: model, Key: key, Enabled: true}, true
}

func (s *Server) defaultProviderID(ctx context.Context) string {
	doc, err := s.Store.Get(ctx, aiMetaCollection, "default")
	if err != nil {
		return ""
	}
	return text(doc["provider_id"])
}

// aiResolve picks the requested provider, else the default, else the first enabled one.
func (s *Server) aiResolve(ctx context.Context, id string) (aiProvider, error) {
	load := func(pid string) (aiProvider, bool) {
		if pid == legacyProviderID {
			return s.legacyProvider(ctx)
		}
		doc, err := s.Store.Get(ctx, aiProvidersCollection, pid)
		if err != nil {
			return aiProvider{}, false
		}
		p := s.providerFromDoc(pid, doc)
		return p, p.Enabled && p.Model != ""
	}
	if id != "" {
		if p, ok := load(id); ok {
			return p, nil
		}
		return aiProvider{}, errors.New("provider not available")
	}
	if d := s.defaultProviderID(ctx); d != "" {
		if p, ok := load(d); ok {
			return p, nil
		}
	}
	docs, _ := s.Store.List(ctx, aiProvidersCollection)
	sort.Slice(docs, func(i, j int) bool { return text(docs[i]["created_at"]) < text(docs[j]["created_at"]) })
	for _, d := range docs {
		if p, ok := load(text(d["id"])); ok {
			return p, nil
		}
	}
	if p, ok := s.legacyProvider(ctx); ok {
		return p, nil
	}
	return aiProvider{}, errors.New("no provider")
}

func aiClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func aiPost(ctx context.Context, p aiProvider, path string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	p.setHeaders(req)
	if p.Kind == "anthropic" {
		req.Header.Set("x-api-key", p.Key)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else if p.Key != "" {
		req.Header.Set("Authorization", "Bearer "+p.Key)
	}
	resp, err := aiClient(110 * time.Second).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		// The provider's own reason (bad model name, unsupported parameter) is what an administrator needs; only the connection check shows it.
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 400))
		return errors.New("provider status " + resp.Status + ": " + strings.TrimSpace(string(detail)))
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4*1024*1024)).Decode(out)
}

type anthropicResp struct {
	Content []map[string]any `json:"content"`
}

type openaiResp struct {
	Choices []struct {
		Message struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
}

// aiLoop runs one tool using conversation against either protocol and returns the final text.
func (s *Server) aiLoop(ctx context.Context, p aiProvider, system, user string, run func(name string, input map[string]any) string) (string, error) {
	if p.Kind == "anthropic" {
		messages := []map[string]any{{"role": "user", "content": user}}
		for turn := 0; turn < aiMaxTurns; turn++ {
			var resp anthropicResp
			if err := aiPost(ctx, p, "/v1/messages", map[string]any{"model": p.Model, "max_tokens": p.tokens(), "system": system, "tools": aiTools, "messages": messages}, &resp); err != nil {
				return "", err
			}
			messages = append(messages, map[string]any{"role": "assistant", "content": resp.Content})
			results := []map[string]any{}
			var out strings.Builder
			for _, block := range resp.Content {
				switch block["type"] {
				case "text":
					out.WriteString(text(block["text"]))
				case "tool_use":
					input, _ := block["input"].(map[string]any)
					results = append(results, map[string]any{"type": "tool_result", "tool_use_id": block["id"], "content": run(text(block["name"]), input)})
				}
			}
			if len(results) == 0 {
				return out.String(), nil
			}
			messages = append(messages, map[string]any{"role": "user", "content": results})
		}
		return "", errors.New("no final answer")
	}
	tools := []map[string]any{}
	for _, t := range aiTools {
		tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}})
	}
	messages := []map[string]any{{"role": "system", "content": system}, {"role": "user", "content": user}}
	for turn := 0; turn < aiMaxTurns; turn++ {
		var resp openaiResp
		if err := aiPost(ctx, p, "/chat/completions", map[string]any{"model": p.Model, "max_tokens": p.tokens(), "tools": tools, "messages": messages}, &resp); err != nil {
			return "", err
		}
		if len(resp.Choices) == 0 {
			return "", errors.New("empty response")
		}
		msg := resp.Choices[0].Message
		if len(msg.ToolCalls) == 0 {
			return msg.Content, nil
		}
		calls := []map[string]any{}
		for _, c := range msg.ToolCalls {
			calls = append(calls, map[string]any{"id": c.ID, "type": "function", "function": map[string]any{"name": c.Function.Name, "arguments": c.Function.Arguments}})
		}
		messages = append(messages, map[string]any{"role": "assistant", "content": msg.Content, "tool_calls": calls})
		for _, c := range msg.ToolCalls {
			var input map[string]any
			_ = json.Unmarshal([]byte(c.Function.Arguments), &input)
			messages = append(messages, map[string]any{"role": "tool", "tool_call_id": c.ID, "content": run(c.Function.Name, input)})
		}
	}
	return "", errors.New("no final answer")
}

func (s *Server) aiPing(ctx context.Context, p aiProvider) error {
	if p.Kind == "anthropic" {
		var out anthropicResp
		return aiPost(ctx, p, "/v1/messages", map[string]any{"model": p.Model, "max_tokens": 8, "messages": []map[string]any{{"role": "user", "content": "ping"}}}, &out)
	}
	var out openaiResp
	return aiPost(ctx, p, "/chat/completions", map[string]any{"model": p.Model, "max_tokens": 8, "messages": []map[string]any{{"role": "user", "content": "ping"}}}, &out)
}

func (s *Server) aiModelList(ctx context.Context, p aiProvider) ([]map[string]string, error) {
	path := "/models"
	if p.Kind == "anthropic" {
		path = "/v1/models?limit=100"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	p.setHeaders(req)
	if p.Kind == "anthropic" {
		req.Header.Set("x-api-key", p.Key)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else if p.Key != "" {
		req.Header.Set("Authorization", "Bearer "+p.Key)
	}
	resp, err := aiClient(20 * time.Second).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, errors.New("provider status " + resp.Status)
	}
	var payload struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&payload); err != nil {
		return nil, err
	}
	out := []map[string]string{}
	for _, m := range payload.Data {
		if len(m.ID) <= 120 {
			out = append(out, map[string]string{"id": m.ID, "name": m.DisplayName})
		}
	}
	return out, nil
}

func (s *Server) providerView(p aiProvider, def string, builtin bool) map[string]any {
	return map[string]any{"id": p.ID, "name": p.Name, "kind": p.Kind, "base_url": p.BaseURL, "model": p.Model, "has_key": p.Key != "", "headers": p.Headers, "enabled": p.Enabled, "default": p.ID == def, "readonly": builtin}
}

func (s *Server) aiProviderRoutes(mux *http.ServeMux) {
	manage := func(h http.HandlerFunc) http.HandlerFunc { return s.requirePerm("ai.manage", h) }
	mux.HandleFunc("GET /api/ai/providers", manage(func(w http.ResponseWriter, r *http.Request) {
		docs, err := s.Store.List(r.Context(), aiProvidersCollection)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		sort.Slice(docs, func(i, j int) bool { return text(docs[i]["created_at"]) < text(docs[j]["created_at"]) })
		def := s.defaultProviderID(r.Context())
		out := []map[string]any{}
		for _, d := range docs {
			out = append(out, s.providerView(s.providerFromDoc(text(d["id"]), d), def, false))
		}
		if p, ok := s.legacyProvider(r.Context()); ok {
			out = append(out, s.providerView(p, def, true))
		}
		if def == "" {
			// With no explicit default the first usable provider is used; mark it.
			if p, err := s.aiResolve(r.Context(), ""); err == nil {
				for _, row := range out {
					if row["id"] == p.ID {
						row["default"] = true
					}
				}
			}
		}
		chat := ""
		if doc, err := s.Store.Get(r.Context(), aiMetaCollection, aiChatMeta); err == nil {
			chat = text(doc["provider_id"])
		}
		for _, row := range out {
			row["chat"] = chat != "" && row["id"] == chat
		}
		writeJSON(w, 200, map[string]any{"vault_ready": s.Config.VaultKey != "", "providers": out})
	}))
	type input struct {
		Name     string `json:"name"`
		Kind     string `json:"kind"`
		BaseURL  string `json:"base_url"`
		Model    string `json:"model"`
		APIKey   string `json:"api_key"`
		Headers  string `json:"headers"`
		ClearKey bool   `json:"clear_key"`
		Enabled  *bool  `json:"enabled"`
	}
	validate := func(w http.ResponseWriter, in *input) bool {
		in.Name = strings.TrimSpace(in.Name)
		in.Model = strings.TrimSpace(in.Model)
		if in.Name == "" || len(in.Name) > 60 {
			problem(w, 400, "Name must be 1 to 60 characters")
			return false
		}
		if in.Kind != "anthropic" && in.Kind != "openai" {
			problem(w, 400, "Kind must be anthropic or openai (OpenAI compatible, includes local servers)")
			return false
		}
		if in.Model == "" || len(in.Model) > 120 || strings.ContainsAny(in.Model, "\r\n\t") {
			problem(w, 400, "Model is required")
			return false
		}
		if strings.TrimSpace(in.BaseURL) == "" {
			in.BaseURL = defaultBaseURL(in.Kind)
		}
		clean, ok := validProviderURL(in.BaseURL)
		if !ok {
			problem(w, 400, "Base URL must be an http or https address without credentials")
			return false
		}
		in.BaseURL = clean
		if _, err := parseHeaders(in.Headers); err != nil {
			problem(w, 400, err.Error())
			return false
		}
		if in.APIKey != "" && (len(in.APIKey) > 512 || strings.ContainsAny(in.APIKey, " \r\n\t")) {
			problem(w, 400, "API key has an invalid format")
			return false
		}
		if in.APIKey != "" && s.Config.VaultKey == "" {
			problem(w, 503, "Credential vault is not configured; set WEARDEN_VAULT_KEY in the environment first")
			return false
		}
		return true
	}
	seal := func(key string) (string, error) {
		sealed, err := security.Seal(s.Config.VaultKey, []byte(key))
		return base64.StdEncoding.EncodeToString(sealed), err
	}
	// Check tests the form values before anything is saved. When editing, an empty key reuses the stored one.
	mux.HandleFunc("POST /api/ai/providers/check", manage(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			input
			ID string `json:"id"`
		}
		if !decode(w, r, &in) || !validate(w, &in.input) {
			return
		}
		p := aiProvider{Name: in.Name, Kind: in.Kind, BaseURL: in.BaseURL, Model: in.Model, Key: in.APIKey, Headers: in.Headers, Enabled: true}
		if p.Key == "" && in.ID != "" {
			if doc, err := s.Store.Get(r.Context(), aiProvidersCollection, in.ID); err == nil {
				p.Key = s.openKey(doc)
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		started := time.Now()
		if err := s.aiPing(ctx, p); err != nil {
			// Still offer the model list: a wrong model name is the most common failure.
			failed, _ := s.aiModelList(ctx, p)
			writeJSON(w, 200, map[string]any{"ok": false, "message": "Connection failed: " + err.Error(), "models": failed})
			return
		}
		latency := time.Since(started).Milliseconds()
		models, _ := s.aiModelList(ctx, p)
		listed := false
		for _, m := range models {
			listed = listed || m["id"] == p.Model
		}
		writeJSON(w, 200, map[string]any{"ok": true, "message": "The provider answered.", "latency_ms": latency, "models": models, "model_listed": listed})
	}))
	mux.HandleFunc("POST /api/ai/providers", manage(func(w http.ResponseWriter, r *http.Request) {
		var in input
		if !decode(w, r, &in) || !validate(w, &in) {
			return
		}
		id, err := security.Random()
		if err != nil {
			problem(w, 500, "Cannot create id")
			return
		}
		id = id[:12]
		enabled := in.Enabled == nil || *in.Enabled
		doc := map[string]any{"id": id, "name": in.Name, "kind": in.Kind, "base_url": in.BaseURL, "model": in.Model, "headers": in.Headers, "enabled": enabled, "created_by": current(r).Username, "created_at": now()}
		if in.APIKey != "" {
			sealed, err := seal(in.APIKey)
			if err != nil {
				problem(w, 503, "Credential vault is not configured")
				return
			}
			doc["sealed_key"] = sealed
		}
		if err := s.Store.Put(r.Context(), aiProvidersCollection, id, doc); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "ai.provider_created", in.Name, true, in.Kind)
		writeJSON(w, 201, s.providerView(s.providerFromDoc(id, doc), s.defaultProviderID(r.Context()), false))
	}))
	mux.HandleFunc("PUT /api/ai/providers/{id}", manage(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		doc, err := s.Store.Get(r.Context(), aiProvidersCollection, id)
		if err != nil {
			problem(w, 404, "Provider not found")
			return
		}
		var in input
		if !decode(w, r, &in) || !validate(w, &in) {
			return
		}
		doc["name"], doc["kind"], doc["base_url"], doc["model"], doc["headers"] = in.Name, in.Kind, in.BaseURL, in.Model, in.Headers
		if in.Enabled != nil {
			doc["enabled"] = *in.Enabled
		}
		if in.ClearKey {
			delete(doc, "sealed_key")
		}
		if in.APIKey != "" {
			sealed, err := seal(in.APIKey)
			if err != nil {
				problem(w, 503, "Credential vault is not configured")
				return
			}
			doc["sealed_key"] = sealed
		}
		doc["updated_by"], doc["updated_at"] = current(r).Username, now()
		if err := s.Store.Put(r.Context(), aiProvidersCollection, id, doc); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "ai.provider_updated", in.Name, true, "")
		writeJSON(w, 200, s.providerView(s.providerFromDoc(id, doc), s.defaultProviderID(r.Context()), false))
	}))
	mux.HandleFunc("DELETE /api/ai/providers/{id}", manage(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		doc, err := s.Store.Get(r.Context(), aiProvidersCollection, id)
		if err != nil {
			problem(w, 404, "Provider not found")
			return
		}
		if _, err := s.DB.ExecContext(r.Context(), "DELETE FROM documents WHERE collection=$1 AND id=$2", aiProvidersCollection, id); err != nil {
			s.databaseError(w, err)
			return
		}
		if s.defaultProviderID(r.Context()) == id {
			_, _ = s.DB.ExecContext(r.Context(), "DELETE FROM documents WHERE collection=$1 AND id='default'", aiMetaCollection)
		}
		s.audit(r, "ai.provider_deleted", text(doc["name"]), true, "")
		w.WriteHeader(204)
	}))
	mux.HandleFunc("POST /api/ai/providers/{id}/default", manage(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if p, err := s.aiResolve(r.Context(), id); err != nil || p.ID != id {
			problem(w, 409, "Only an enabled provider with a model can be the default")
			return
		}
		if err := s.Store.Put(r.Context(), aiMetaCollection, "default", map[string]any{"provider_id": id, "updated_by": current(r).Username, "updated_at": now()}); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "ai.default_changed", id, true, "")
		w.WriteHeader(204)
	}))
	mux.HandleFunc("POST /api/ai/providers/{id}/test", manage(func(w http.ResponseWriter, r *http.Request) {
		p, err := s.aiResolve(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, 409, "Provider is disabled or incomplete")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		started := time.Now()
		if err := s.aiPing(ctx, p); err != nil {
			writeJSON(w, 200, map[string]any{"ok": false, "message": "The provider did not accept the request. Check the address, the model name and the key."})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "model": p.Model, "latency_ms": time.Since(started).Milliseconds(), "message": "The provider answered."})
	}))
	mux.HandleFunc("GET /api/ai/providers/{id}/models", manage(func(w http.ResponseWriter, r *http.Request) {
		p, err := s.aiResolve(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, 409, "Provider is disabled or incomplete")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		list, err := s.aiModelList(ctx, p)
		if err != nil {
			problem(w, 502, "The provider did not return a model list")
			return
		}
		writeJSON(w, 200, list)
	}))
}
