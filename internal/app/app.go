package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/Wearden/core/internal/benchmarks"
	"github.com/Wearden/core/internal/store"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Config struct{ VaultKey, GuacKey, SessionControlKey, RecordingsDir, AnthropicKey, AnthropicModel, AllowedOrigin, DownloadsDir string }
type Server struct {
	DB         *sql.DB
	Store      *store.Store
	Catalog    benchmarks.Catalog
	Config     Config
	mu         sync.Mutex
	attempts   map[string]attempt
	loginSlots chan struct{}
}
type attempt struct {
	Count int
	Reset time.Time
}
type User struct {
	ID         int64  `json:"id"`
	Username   string `json:"username"`
	Role       string `json:"role"`
	MustChange bool   `json:"must_change_password"`
}
type contextKey int

const userKey contextKey = 1

func New(db *store.Store, catalog benchmarks.Catalog, cfg Config) *Server {
	return &Server{DB: db.DB, Store: db, Catalog: catalog, Config: cfg, attempts: map[string]attempt{}, loginSlots: make(chan struct{}, 4)}
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if value != nil {
		if err := json.NewEncoder(w).Encode(value); err != nil {
			slog.Error("response encoding failed")
		}
	}
}
func problem(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"detail": message})
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		problem(w, 400, "Invalid JSON request")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		problem(w, 400, "Trailing request data")
		return false
	}
	return true
}
func current(r *http.Request) User { u, _ := r.Context().Value(userKey).(User); return u }
func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") || len(h) > 1024 {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
}
func (s *Server) user(ctx context.Context, token string) (User, error) {
	var u User
	if token == "" {
		return u, sql.ErrNoRows
	}
	err := s.DB.QueryRowContext(ctx, `SELECT u.id,u.username,u.role,u.must_change_password FROM users u JOIN user_tokens t ON t.user_id=u.id WHERE t.hash=$1 AND t.kind='access' AND t.expires_at>now() AND u.active`, digest(token)).Scan(&u.ID, &u.Username, &u.Role, &u.MustChange)
	return u, err
}
func (s *Server) require(role string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := s.user(r.Context(), bearer(r))
		if err != nil {
			problem(w, 401, "Not authenticated")
			return
		}
		ranks := map[string]int{"viewer": 1, "operator": 2, "admin": 3}
		if ranks[u.Role] < ranks[role] {
			problem(w, 403, "Insufficient role")
			return
		}
		if u.MustChange && r.URL.Path != "/api/auth/me" && r.URL.Path != "/api/auth/change-password" && r.URL.Path != "/api/auth/logout" {
			problem(w, 403, "Change the initial password first")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	}
}
func (s *Server) audit(r *http.Request, action, target string, success bool, detail string) {
	u := current(r)
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if _, err := s.DB.ExecContext(r.Context(), "INSERT INTO audit_log(username,action,target,success,ip,detail) VALUES($1,$2,$3,$4,$5,$6)", u.Username, action, target, success, ip, detail); err != nil {
		slog.Error("audit event persistence failed", "action", action)
	}
}
func (s *Server) databaseError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "Not found")
		return
	}
	slog.Error("database operation failed")
	problem(w, 500, "Database operation failed")
}
func integer(v any) int64 {
	switch v := v.(type) {
	case float64:
		return int64(v)
	case int:
		return int64(v)
	case int64:
		return v
	case json.Number:
		n, _ := v.Int64()
		return n
	}
	return 0
}
func text(v any) string { s, _ := v.(string); return s }
func now() string       { return time.Now().UTC().Format(time.RFC3339Nano) }
func limit(r *http.Request, max int) int {
	v, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || v < 1 {
		return min(200, max)
	}
	return min(v, max)
}
func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	m.HandleFunc("GET /api/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if s.DB.PingContext(ctx) != nil {
			problem(w, 503, "Database unavailable")
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok", "database": "ok"})
	})
	m.HandleFunc("POST /api/auth/login", s.login)
	m.HandleFunc("POST /api/auth/refresh", s.refresh)
	m.HandleFunc("GET /api/auth/me", s.require("viewer", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, current(r)) }))
	m.HandleFunc("POST /api/auth/change-password", s.require("viewer", s.changePassword))
	m.HandleFunc("POST /api/auth/logout", s.require("viewer", s.logout))
	s.assetRoutes(m)
	s.agentRoutes(m)
	s.benchmarkRoutes(m)
	s.scanRoutes(m)
	s.hardeningRoutes(m)
	s.driftRoutes(m)
	s.featureRoutes(m)
	s.settingsRoutes(m)
	s.agentLogRoutes(m)
	s.installRoutes(m)
	s.aiRoutes(m)
	s.scheduleRoutes(m)
	s.websocketRoutes(m)
	s.sessionControlRoutes(m)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if recover() != nil {
				slog.Error("request handler panic")
				problem(w, 500, "Internal server error")
			}
		}()
		m.ServeHTTP(w, r)
	})
}
