package app

import (
	"net/http"
	"strconv"

	"github.com/Wearden/core/internal/security"
)

// Self registration. There is no administrator account in the environment: the very
// first person to register becomes the one and only administrator (a database index
// guarantees there is never a second one). Everyone who registers afterwards gets a
// viewer account that stays disabled until the administrator approves it. Usernames are
// case-insensitive, so "Admin" and "admin" are the same name.
const platformMetaCollection = "platform_meta"

func (s *Server) registrationOpen(r *http.Request) bool {
	doc, err := s.Store.Get(r.Context(), platformMetaCollection, "registration")
	if err != nil {
		return true
	}
	open, ok := doc["open"].(bool)
	return !ok || open
}

func (s *Server) adminExists(r *http.Request) (bool, error) {
	var exists bool
	err := s.DB.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE role='admin')").Scan(&exists)
	return exists, err
}

func (s *Server) registrationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/setup", func(w http.ResponseWriter, r *http.Request) {
		exists, err := s.adminExists(r)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"admin_exists": exists, "registration_open": !exists || s.registrationOpen(r)})
	})
	mux.HandleFunc("POST /api/auth/register", func(w http.ResponseWriter, r *http.Request) {
		if !s.rateAllowed(r) {
			problem(w, 429, "Too many attempts")
			return
		}
		var in struct{ Username, Password string }
		if !decode(w, r, &in) {
			return
		}
		if !usernameRE.MatchString(in.Username) {
			problem(w, 400, "Username must be 3 to 64 characters: letters, digits, dot, dash, underscore")
			return
		}
		hash, err := security.HashPassword(in.Password)
		if err != nil {
			problem(w, 400, err.Error())
			return
		}
		tx, err := s.DB.BeginTx(r.Context(), nil)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer tx.Rollback()
		// Serialize registrations so two people cannot both become the first administrator.
		if _, err = tx.ExecContext(r.Context(), "SELECT pg_advisory_xact_lock(73194332)"); err != nil {
			s.databaseError(w, err)
			return
		}
		var exists bool
		if err = tx.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE role='admin')").Scan(&exists); err != nil {
			s.databaseError(w, err)
			return
		}
		if exists && !s.registrationOpen(r) {
			problem(w, 403, "Registration is closed; ask the administrator for an account")
			return
		}
		role, active, pending := "admin", true, false
		if exists {
			role, active, pending = "viewer", false, true
		}
		var id int64
		err = tx.QueryRowContext(r.Context(), "INSERT INTO users(username,password_hash,role,active,pending,must_change_password) VALUES($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING RETURNING id", in.Username, hash, role, active, pending).Scan(&id)
		if err != nil {
			problem(w, 409, "This username is already taken")
			return
		}
		if exists {
			if err = tx.Commit(); err != nil {
				s.databaseError(w, err)
				return
			}
			s.audit(r, "auth.registered", in.Username, true, "pending")
			writeJSON(w, 202, map[string]any{"status": "pending"})
			return
		}
		tokens, err := s.issue(r.Context(), tx, User{ID: id, Username: in.Username, Role: role})
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "auth.registered", in.Username, true, "administrator")
		tokens["status"] = "admin"
		writeJSON(w, 201, tokens)
	})
	mux.HandleFunc("GET /api/registration", s.requirePerm("users.manage", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"open": s.registrationOpen(r)})
	}))
	mux.HandleFunc("PUT /api/registration", s.requirePerm("users.manage", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Open bool `json:"open"`
		}
		if !decode(w, r, &in) {
			return
		}
		doc := map[string]any{"open": in.Open, "updated_by": current(r).Username, "updated_at": now()}
		if err := s.Store.Put(r.Context(), platformMetaCollection, "registration", doc); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "registration.changed", strconv.FormatBool(in.Open), true, "")
		writeJSON(w, 200, map[string]any{"open": in.Open})
	}))
	mux.HandleFunc("POST /api/users/{id}/approve", s.requirePerm("users.manage", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			problem(w, 400, "Invalid user id")
			return
		}
		var name string
		err = s.DB.QueryRowContext(r.Context(), "UPDATE users SET active=true, pending=false WHERE id=$1 AND pending RETURNING username", id).Scan(&name)
		if err != nil {
			problem(w, 404, "No pending registration with this id")
			return
		}
		s.audit(r, "user.approved", name, true, "")
		w.WriteHeader(204)
	}))
}
