package app

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/Wearden/proto/wire"
)

const (
	defaultLogRetentionDays = 30
	maxLogsPerAgent         = 20000
)

func (s *Server) agentLogRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/agent/v1/logs", s.ingestAgentLogs)
	mux.HandleFunc("GET /api/agents/{id}/logs", s.require("viewer", s.listAgentLogs))
}

func (s *Server) ingestAgentLogs(w http.ResponseWriter, r *http.Request) {
	a, err := s.agentIdentity(r)
	if err != nil {
		problem(w, 401, "Invalid agent credential")
		return
	}
	var in wire.LogBatch
	if !decode(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil || in.AgentID != a.ID {
		problem(w, 400, "Invalid log batch")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var live string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM agents WHERE id=$1 AND NOT revoked", a.ID).Scan(&live) != nil {
		problem(w, 401, "Agent revoked")
		return
	}
	limit := time.Now().UTC().Add(5 * time.Minute)
	for _, e := range in.Entries {
		at := e.Time.UTC()
		if at.After(limit) {
			at = limit // an agent clock far in the future must not outlive retention
		}
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO agent_logs(agent_id,logged_at,level,message) VALUES($1,$2,$3,$4)", a.ID, at, e.Level, e.Message); err != nil {
			s.databaseError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		s.databaseError(w, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) listAgentLogs(w http.ResponseWriter, r *http.Request) {
	n := limit(r, 500)
	if r.URL.Query().Get("limit") == "" {
		n = 100
	}
	level := r.URL.Query().Get("level")
	if level != "" && level != "info" && level != "warn" && level != "error" {
		problem(w, 400, "Invalid level")
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	rows, err := s.DB.QueryContext(r.Context(), `SELECT id,logged_at,level,message FROM agent_logs
		WHERE agent_id=$1 AND ($2='' OR level=$2) AND ($3=0 OR id<$3) ORDER BY id DESC LIMIT $4`, r.PathValue("id"), level, before, n)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var at time.Time
		var lvl, msg string
		if err := rows.Scan(&id, &at, &lvl, &msg); err != nil {
			s.databaseError(w, err)
			return
		}
		out = append(out, map[string]any{"id": id, "logged_at": at, "level": lvl, "message": msg})
	}
	if rows.Err() != nil {
		s.databaseError(w, rows.Err())
		return
	}
	writeJSON(w, 200, out)
}

// pruneAgentLogs applies the time retention (UI-settable) and a per-agent row cap.
func (s *Server) pruneAgentLogs(ctx context.Context) {
	days := defaultLogRetentionDays
	if v, _ := s.setting(ctx, "log_retention_days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 365 {
			days = n
		}
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM agent_logs WHERE received_at < now() - make_interval(days => $1)", days); err != nil && ctx.Err() == nil {
		slog.Error("agent log retention failed")
	}
	if _, err := s.DB.ExecContext(ctx, `DELETE FROM agent_logs WHERE id IN (
		SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY agent_id ORDER BY id DESC) AS rn FROM agent_logs) t WHERE rn > $1)`, maxLogsPerAgent); err != nil && ctx.Err() == nil {
		slog.Error("agent log cap failed")
	}
}
