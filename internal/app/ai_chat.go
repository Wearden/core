package app

import (
	"context"
	"net/http"
	"strings"
	"time"
)

const aiChatMeta = "chat"

// chatResolve uses the provider chosen for chat; with none chosen it follows the default. A chosen but unusable provider is an error, so chat never silently switches vendor.
func (s *Server) chatResolve(ctx context.Context) (aiProvider, error) {
	if doc, err := s.Store.Get(ctx, aiMetaCollection, aiChatMeta); err == nil && text(doc["provider_id"]) != "" {
		return s.aiResolve(ctx, text(doc["provider_id"]))
	}
	return s.aiResolve(ctx, "")
}

func (s *Server) aiChatRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/ai/chat", s.require("viewer", s.aiChat))
	manage := func(h http.HandlerFunc) http.HandlerFunc { return s.requirePerm("ai.manage", h) }
	mux.HandleFunc("POST /api/ai/providers/{id}/chat", manage(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if p, err := s.aiResolve(r.Context(), id); err != nil || p.ID != id {
			problem(w, 409, "Only an enabled provider with a model can be used for chat")
			return
		}
		if err := s.Store.Put(r.Context(), aiMetaCollection, aiChatMeta, map[string]any{"provider_id": id, "updated_by": current(r).Username, "updated_at": now()}); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "ai.chat_provider_changed", id, true, "")
		w.WriteHeader(204)
	}))
	mux.HandleFunc("DELETE /api/ai/chat-provider", manage(func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.Put(r.Context(), aiMetaCollection, aiChatMeta, map[string]any{"provider_id": "", "updated_by": current(r).Username, "updated_at": now()}); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "ai.chat_provider_changed", "", true, "")
		w.WriteHeader(204)
	}))
}

const (
	chatMaxMessages = 6
	chatMaxChars    = 1000
)

// Support chat. Only what the user typed is sent to the provider: no scan data, hosts or credentials.
// shortcut: aiLoop still advertises its scan tools, so they are answered with an error; split aiLoop if chat needs its own tools.
func (s *Server) aiChat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		Language string `json:"language"`
		Page     string `json:"page"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Messages) == 0 || in.Messages[len(in.Messages)-1].Role != "user" {
		problem(w, 400, "Last message must come from the user")
		return
	}
	if len(in.Messages) > chatMaxMessages {
		in.Messages = in.Messages[len(in.Messages)-chatMaxMessages:]
	}
	prov, err := s.chatResolve(r.Context())
	if err != nil {
		problem(w, 503, "No AI provider is available for chat; an administrator can set one under Settings")
		return
	}
	prov.MaxTokens = 1000 // frugal: short answers; room is left for models that spend part of the limit on reasoning
	var convo strings.Builder
	for _, m := range in.Messages {
		who := "Customer"
		if m.Role == "assistant" {
			who = "You"
		} else if m.Role != "user" {
			problem(w, 400, "Unsupported message role")
			return
		}
		if len(m.Content) > chatMaxChars {
			problem(w, 400, "Message is too long")
			return
		}
		convo.WriteString(who + ": " + m.Content + "\n")
	}
	language := "English"
	if in.Language == "az" {
		language = "Azerbaijani"
	}
	page := in.Page
	if len(page) > 100 {
		page = ""
	}
	system := "You are Wardy, the support assistant of Wearden (an agent-based security hardening platform), chatting inside its web app. Sound like a friendly colleague. Be brief: at most three short sentences, or five short bullets if steps are needed, unless asked for more. No headings, no filler. " +
		"Reply in the language of the user's last message; if it is unclear use " + language + ". " +
		"Pages: Dashboard, Assets (hosts and agents), Scans, Hardening (reviewed plans, applied only after confirmation), Rollback, Benchmarks, Reports, Audit log, Settings (users, AI providers, access). Roles: viewer, operator, admin; admins manage Settings. " +
		"You cannot see their data or change anything. Never ask for passwords, tokens or API keys. If unsure, say so and point to an administrator; never invent features, settings or commands. " +
		"Politely refuse in one sentence anything illegal or harmful (attacking systems the user does not own, malware, evading detection, abuse) and offer legitimate help instead; defensive hardening questions are welcome. If sincerely asked, say you are an AI. " +
		"The user is on the page \"" + page + "\"."
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	reply, err := s.aiLoop(ctx, prov, system, convo.String()+"You:", func(string, map[string]any) string {
		return `{"error":"no tools are available in chat"}`
	})
	if err != nil {
		problem(w, 502, "AI provider request failed")
		return
	}
	writeJSON(w, 200, map[string]any{"reply": strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(reply), "You:"))})
}
