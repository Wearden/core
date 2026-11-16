package app

import (
	"database/sql"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/Wearden/core/internal/security"
)

var usernameRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$`)

// Administrator-only user management. Passwords are hashed with the shared policy
// and never logged; a new or reset password must be changed at the next sign-in.
func (s *Server) userRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/users", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.DB.QueryContext(r.Context(), "SELECT id,username,role,active,must_change_password,created_at FROM users ORDER BY id")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id int64
			var name, role string
			var active, must bool
			var created time.Time
			if err := rows.Scan(&id, &name, &role, &active, &must, &created); err != nil {
				s.databaseError(w, err)
				return
			}
			out = append(out, map[string]any{"id": id, "username": name, "role": role, "active": active, "must_change_password": must, "created_at": created})
		}
		writeJSON(w, 200, out)
	}))
	mux.HandleFunc("POST /api/users", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Username, Password, Role string }
		if !decode(w, r, &in) {
			return
		}
		if !usernameRE.MatchString(in.Username) || (in.Role != "viewer" && in.Role != "operator" && in.Role != "admin") {
			problem(w, 400, "Invalid username or role")
			return
		}
		hash, err := security.HashPassword(in.Password)
		if err != nil {
			problem(w, 400, err.Error())
			return
		}
		var id int64
		err = s.DB.QueryRowContext(r.Context(), "INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING RETURNING id", in.Username, hash, in.Role).Scan(&id)
		if err == sql.ErrNoRows {
			problem(w, 409, "Username already exists")
			return
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "user.created", in.Username, true, in.Role)
		writeJSON(w, 201, map[string]any{"id": id, "username": in.Username, "role": in.Role})
	}))
	mux.HandleFunc("PATCH /api/users/{id}", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		var in struct {
			Role   *string `json:"role"`
			Active *bool   `json:"active"`
		}
		if err != nil {
			problem(w, 400, "Invalid user id")
			return
		}
		if !decode(w, r, &in) {
			return
		}
		if in.Role == nil && in.Active == nil {
			problem(w, 400, "Nothing to update")
			return
		}
		if in.Role != nil && *in.Role != "viewer" && *in.Role != "operator" && *in.Role != "admin" {
			problem(w, 400, "Invalid role")
			return
		}
		if id == current(r).ID {
			problem(w, 409, "You cannot change your own role or active state")
			return
		}
		tx, err := s.DB.BeginTx(r.Context(), nil)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer tx.Rollback()
		var name string
		if tx.QueryRowContext(r.Context(), "SELECT username FROM users WHERE id=$1 FOR UPDATE", id).Scan(&name) != nil {
			problem(w, 404, "User not found")
			return
		}
		if in.Role != nil {
			_, err = tx.ExecContext(r.Context(), "UPDATE users SET role=$1 WHERE id=$2", *in.Role, id)
		}
		if err == nil && in.Active != nil {
			_, err = tx.ExecContext(r.Context(), "UPDATE users SET active=$1 WHERE id=$2", *in.Active, id)
			if err == nil && !*in.Active {
				_, err = tx.ExecContext(r.Context(), "DELETE FROM user_tokens WHERE user_id=$1", id)
			}
		}
		var admins int
		if err == nil {
			err = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM users WHERE role='admin' AND active").Scan(&admins)
		}
		if err == nil && admins < 1 {
			problem(w, 409, "At least one active administrator is required")
			return
		}
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "user.updated", name, true, "")
		w.WriteHeader(204)
	}))
	mux.HandleFunc("POST /api/users/{id}/reset-password", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		var in struct{ Password string }
		if err != nil {
			problem(w, 400, "Invalid user id")
			return
		}
		if !decode(w, r, &in) {
			return
		}
		hash, err := security.HashPassword(in.Password)
		if err != nil {
			problem(w, 400, err.Error())
			return
		}
		var name string
		err = s.DB.QueryRowContext(r.Context(), "UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2 RETURNING username", hash, id).Scan(&name)
		if err == sql.ErrNoRows {
			problem(w, 404, "User not found")
			return
		}
		if err == nil {
			_, err = s.DB.ExecContext(r.Context(), "DELETE FROM user_tokens WHERE user_id=$1", id)
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "user.password_reset", name, true, "")
		w.WriteHeader(204)
	}))
}
