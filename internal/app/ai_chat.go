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
	chatMaxMessages = 10
	chatMaxChars    = 2000
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
	system := "You are Wardy, a friendly member of the Wearden support team, chatting inside the Wearden web app. Talk like a warm, concise colleague: short plain sentences, no markdown headings, no corporate filler. " +
		"Wearden is an agent-based security hardening platform: Dashboard, Assets (hosts and agents), Scans, Hardening (reviewed plans, applied only after confirmation), Rollback, Benchmarks, Reports, Audit log and Settings (users, AI providers, access). Roles are viewer, operator and admin; admins manage Settings. " +
		"Help administrators and users with how to use these pages, enroll agents, read scan results and fix common problems. If you are unsure or the question needs account or server access, say so and point them to an administrator; never invent features, settings or commands. " +
		"You cannot see their hosts, scans or data and cannot change anything. Never ask for passwords, tokens or API keys. If someone sincerely asks, say you are an AI assistant. " +
		"They are currently on the page \"" + page + "\". Reply in " + language + "."
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
