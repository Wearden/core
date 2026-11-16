package app

import (
	"context"
	"database/sql"
	"github.com/Wearden/core/internal/security"
	"net"
	"net/http"
	"time"
)

func digest(s string) string { return security.Digest(s) }
func (s *Server) rateAllowed(r *http.Request) bool {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	s.mu.Lock()
	defer s.mu.Unlock()
	n := time.Now()
	if _, exists := s.attempts[ip]; !exists && len(s.attempts) >= 10000 {
		for k, v := range s.attempts {
			if n.After(v.Reset) {
				delete(s.attempts, k)
			}
		}
		if len(s.attempts) >= 10000 {
			return false
		}
	}
	a := s.attempts[ip]
	if n.After(a.Reset) {
		a = attempt{Reset: n.Add(time.Minute)}
	}
	a.Count++
	s.attempts[ip] = a
	if len(s.attempts) > 10000 {
		for k, v := range s.attempts {
			if n.After(v.Reset) {
				delete(s.attempts, k)
			}
		}
	}
	return a.Count <= 5
}
func (s *Server) issue(ctx context.Context, tx *sql.Tx, u User) (map[string]any, error) {
	access, err := security.Random()
	if err != nil {
		return nil, err
	}
	refresh, err := security.Random()
	if err != nil {
		return nil, err
	}
	for _, t := range []struct {
		Value, Kind string
		Duration    time.Duration
	}{{access, "access", 30 * time.Minute}, {refresh, "refresh", 7 * 24 * time.Hour}} {
		if _, err := tx.ExecContext(ctx, "INSERT INTO user_tokens(hash,user_id,kind,expires_at) VALUES($1,$2,$3,$4)", digest(t.Value), u.ID, t.Kind, time.Now().Add(t.Duration)); err != nil {
			return nil, err
		}
	}
	return map[string]any{"access_token": access, "refresh_token": refresh, "token_type": "bearer", "must_change_password": u.MustChange}, nil
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.rateAllowed(r) {
		problem(w, 429, "Too many login attempts")
		return
	}
	select {
	case s.loginSlots <- struct{}{}:
		defer func() { <-s.loginSlots }()
	default:
		problem(w, 429, "Login busy; retry later")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Username) > 64 || len(in.Password) > 256 || in.Username == "" || in.Password == "" {
		problem(w, 400, "Invalid username or password length")
		return
	}
	var u User
	var hash string
	var active, pending bool
	// Usernames are case-insensitive: "Admin" and "admin" are the same account.
	err := s.DB.QueryRowContext(r.Context(), "SELECT id,username,role,must_change_password,password_hash,active,pending FROM users WHERE lower(username)=lower($1)", in.Username).Scan(&u.ID, &u.Username, &u.Role, &u.MustChange, &hash, &active, &pending)
	if err != nil || !security.VerifyPassword(in.Password, hash) {
		s.audit(r, "auth.login", in.Username, false, "")
		problem(w, 401, "Invalid credentials")
		return
	}
	if !active {
		s.audit(r, "auth.login", in.Username, false, "inactive")
		if pending {
			problem(w, 403, "Your registration is waiting for administrator approval")
			return
		}
		problem(w, 401, "Invalid credentials")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	tokens, err := s.issue(r.Context(), tx, u)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "auth.login", u.Username, true, "")
	writeJSON(w, 200, tokens)
}
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"refresh_token"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Token) > 512 {
		problem(w, 401, "Invalid refresh token")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRowContext(r.Context(), "DELETE FROM user_tokens WHERE hash=$1 AND kind='refresh' AND expires_at>now() RETURNING user_id", digest(in.Token)).Scan(&id)
	if err != nil {
		problem(w, 401, "Invalid refresh token")
		return
	}
	var u User
	err = tx.QueryRowContext(r.Context(), "SELECT id,username,role,must_change_password FROM users WHERE id=$1 AND active", id).Scan(&u.ID, &u.Username, &u.Role, &u.MustChange)
	if err != nil {
		problem(w, 401, "Inactive user")
		return
	}
	tokens, err := s.issue(r.Context(), tx, u)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	writeJSON(w, 200, tokens)
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if !decode(w, r, &in) {
		return
	}
	u := current(r)
	var old string
	if err := s.DB.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE id=$1", u.ID).Scan(&old); err != nil {
		s.databaseError(w, err)
		return
	}
	if !security.VerifyPassword(in.Current, old) {
		problem(w, 400, "Current password is incorrect")
		return
	}
	if in.Current == in.New {
		problem(w, 400, "New password must differ")
		return
	}
	hash, err := security.HashPassword(in.New)
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
	result, err := tx.ExecContext(r.Context(), "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2 AND password_hash=$3", hash, u.ID, old)
	if err == nil {
		affected, e := result.RowsAffected()
		if e != nil {
			err = e
		} else if affected != 1 {
			problem(w, 409, "Password changed concurrently; sign in again")
			return
		}
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "DELETE FROM user_tokens WHERE user_id=$1 AND hash<>$2", u.ID, digest(bearer(r)))
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "auth.password_changed", u.Username, true, "")
	w.WriteHeader(204)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if _, err := s.DB.ExecContext(r.Context(), "DELETE FROM user_tokens WHERE user_id=$1", current(r).ID); err != nil {
		s.databaseError(w, err)
		return
	}
	w.WriteHeader(204)
}
