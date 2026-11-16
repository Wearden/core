package app

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/Wearden/core/internal/security"
)

// Secrets and provider options set from the UI. Values are sealed with the
// vault key (WEARDEN_VAULT_KEY stays an environment bootstrap secret: it cannot
// be stored in the database it protects) and never returned by the API.
// GUAC_* keys stay in the environment: the external bridge process reads the same values.
type settingDef struct {
	Label  string
	Secret bool
	Valid  func(string) bool
}

var settingDefs = map[string]settingDef{
	"anthropic_api_key": {"Anthropic API key", true, func(v string) bool { return len(v) >= 20 && len(v) <= 512 && !strings.ContainsAny(v, " \r\n\t") }},
	"anthropic_model":   {"Anthropic model", false, func(v string) bool { return len(v) >= 3 && len(v) <= 100 && !strings.ContainsAny(v, " \r\n\t") }},
}

const settingsCollection = "settings"

// setting returns the UI-set value, else the environment fallback, else "".
func (s *Server) setting(ctx context.Context, key string) (value, source string) {
	if s.Config.VaultKey != "" {
		if doc, err := s.Store.Get(ctx, settingsCollection, key); err == nil {
			if sealed, err := base64.StdEncoding.DecodeString(text(doc["sealed"])); err == nil {
				if plain, err := security.Open(s.Config.VaultKey, sealed); err == nil {
					return string(plain), "database"
				}
			}
		}
	}
	env := map[string]string{"anthropic_api_key": s.Config.AnthropicKey, "anthropic_model": s.Config.AnthropicModel}[key]
	if env != "" {
		return env, "environment"
	}
	return "", "none"
}

func (s *Server) settingsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/settings", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		out := []map[string]any{}
		for _, key := range featureSortedKeys(settingDefs) {
			def := settingDefs[key]
			value, source := s.setting(r.Context(), key)
			row := map[string]any{"key": key, "label": def.Label, "secret": def.Secret, "configured": value != "", "source": source}
			if !def.Secret {
				row["value"] = value
			}
			out = append(out, row)
		}
		writeJSON(w, 200, map[string]any{"vault_ready": s.Config.VaultKey != "", "settings": out})
	}))
	mux.HandleFunc("PUT /api/settings/{key}", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("key")
		def, ok := settingDefs[key]
		if !ok {
			problem(w, 404, "Unknown setting")
			return
		}
		var in struct {
			Value string `json:"value"`
		}
		if !decode(w, r, &in) {
			return
		}
		value := strings.TrimSpace(in.Value)
		if !def.Valid(value) {
			problem(w, 400, "Value has an invalid format or length")
			return
		}
		if s.Config.VaultKey == "" {
			problem(w, 503, "Credential vault is not configured; set WEARDEN_VAULT_KEY in the environment first")
			return
		}
		sealed, err := security.Seal(s.Config.VaultKey, []byte(value))
		if err != nil {
			problem(w, 503, "Credential vault is not configured")
			return
		}
		doc := map[string]any{"sealed": base64.StdEncoding.EncodeToString(sealed), "updated_by": current(r).Username, "updated_at": now()}
		if err := s.Store.Put(r.Context(), settingsCollection, key, doc); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "settings.set", key, true, "") // the value is never logged
		writeJSON(w, 200, map[string]any{"key": key, "configured": true})
	}))
	mux.HandleFunc("DELETE /api/settings/{key}", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("key")
		if _, ok := settingDefs[key]; !ok {
			problem(w, 404, "Unknown setting")
			return
		}
		if _, err := s.DB.ExecContext(r.Context(), "DELETE FROM documents WHERE collection=$1 AND id=$2", settingsCollection, key); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "settings.clear", key, true, "")
		writeJSON(w, 200, map[string]any{"key": key, "configured": false})
	}))
}
