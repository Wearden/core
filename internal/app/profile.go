package app

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"net/http"
	"net/mail"
	"strings"
	"unicode"
)

// Profile: the signed-in user's own display name, contact details and picture.
// The picture is a small raster image stored inline as a data URL; SVG and
// anything else that is not a real PNG, JPEG or WebP is refused.
const maxAvatarBytes = 200 * 1024

var avatarFormats = []struct {
	prefix string
	magic  []byte
}{
	{"data:image/png;base64,", []byte{0x89, 'P', 'N', 'G'}},
	{"data:image/jpeg;base64,", []byte{0xFF, 0xD8, 0xFF}},
	{"data:image/webp;base64,", []byte("RIFF")},
}

// validAvatar accepts an empty value (no picture) or a PNG, JPEG or WebP data URL whose bytes match its type.
func validAvatar(v string) bool {
	if v == "" {
		return true
	}
	for _, f := range avatarFormats {
		if strings.HasPrefix(v, f.prefix) {
			raw, err := base64.StdEncoding.DecodeString(v[len(f.prefix):])
			return err == nil && len(raw) <= maxAvatarBytes && bytes.HasPrefix(raw, f.magic)
		}
	}
	return false
}

// cleanText trims a profile field and refuses control characters and overlong values.
func cleanText(v string, max int) (string, bool) {
	v = strings.TrimSpace(v)
	return v, len([]rune(v)) <= max && !strings.ContainsFunc(v, unicode.IsControl)
}

func (s *Server) profileRoutes(mux *http.ServeMux) {
	load := func(w http.ResponseWriter, r *http.Request) {
		var name, email, title, avatar string
		err := s.DB.QueryRowContext(r.Context(), "SELECT display_name,email,job_title,avatar FROM users WHERE id=$1", current(r).ID).Scan(&name, &email, &title, &avatar)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"display_name": name, "email": email, "job_title": title, "avatar": avatar})
	}
	mux.HandleFunc("GET /api/profile", s.require("viewer", load))
	mux.HandleFunc("PUT /api/profile", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			DisplayName string  `json:"display_name"`
			Email       string  `json:"email"`
			JobTitle    string  `json:"job_title"`
			Avatar      *string `json:"avatar"` // omitted keeps the current picture, "" removes it
		}
		if !decode(w, r, &in) {
			return
		}
		name, ok1 := cleanText(in.DisplayName, 60)
		title, ok2 := cleanText(in.JobTitle, 60)
		email, ok3 := cleanText(in.Email, 120)
		if !ok1 || !ok2 || !ok3 {
			problem(w, 400, "Name and job title may be up to 60 characters and the email up to 120, without control characters")
			return
		}
		if email != "" {
			if a, err := mail.ParseAddress(email); err != nil || a.Address != email {
				problem(w, 400, "Enter a plain email address, for example name@example.com")
				return
			}
		}
		avatar := sql.NullString{}
		if in.Avatar != nil {
			if !validAvatar(*in.Avatar) {
				problem(w, 400, "The picture must be a PNG, JPEG or WebP image of at most 200 KB")
				return
			}
			avatar = sql.NullString{String: *in.Avatar, Valid: true}
		}
		if _, err := s.DB.ExecContext(r.Context(), "UPDATE users SET display_name=$1,email=$2,job_title=$3,avatar=COALESCE($4,avatar) WHERE id=$5", name, email, title, avatar, current(r).ID); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "profile.updated", current(r).Username, true, "")
		load(w, r)
	}))
}
