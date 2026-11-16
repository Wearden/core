package app

import (
	"bytes"
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"github.com/Wearden/core/internal/security"
)

var featureSessionID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (s *Server) featureOpenSession(w http.ResponseWriter, r *http.Request) {
	if len(s.Config.GuacKey) != 32 || len(s.Config.SessionControlKey) < 32 || s.Config.VaultKey == "" || s.Config.RecordingsDir == "" {
		problem(w, 503, "Remote session encryption or recordings are not configured")
		return
	}
	var in struct {
		AssetID int64 `json:"asset_id"`
		Width   int   `json:"width"`
		Height  int   `json:"height"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.AssetID < 1 || in.Width < 320 || in.Width > 7680 || in.Height < 200 || in.Height > 4320 {
		problem(w, 400, "Invalid asset or screen dimensions")
		return
	}
	var raw, encrypted []byte
	var username, authType string
	err := s.DB.QueryRowContext(r.Context(), "SELECT a.data,c.username,c.auth_type,c.encrypted FROM assets a JOIN credentials c ON c.asset_id=a.id WHERE a.id=$1", in.AssetID).Scan(&raw, &username, &authType, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "Asset or stored credential not found")
		return
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	var asset map[string]any
	if err := json.Unmarshal(raw, &asset); err != nil {
		s.databaseError(w, err)
		return
	}
	secret, err := security.Open(s.Config.VaultKey, encrypted)
	if err != nil {
		problem(w, 503, "Cannot decrypt host credential")
		return
	}
	defer clear(secret)
	id, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create session identifier")
		return
	}
	root, err := filepath.Abs(s.Config.RecordingsDir)
	if err != nil {
		problem(w, 503, "Invalid recordings directory")
		return
	}
	settings := map[string]string{"hostname": text(asset["host"]), "username": username, "recording-path": filepath.Join(root, id), "create-recording-path": "true", "recording-name": "session.guac"}
	protocol := ""
	switch text(asset["os_type"]) {
	case "linux":
		protocol = "ssh"
		port := integer(asset["ssh_port"])
		if port == 0 {
			port = 22
		}
		settings["port"] = strconv.FormatInt(port, 10)
		if authType == "ssh_key" {
			settings["private-key"] = string(secret)
		} else if authType == "password" {
			settings["password"] = string(secret)
		} else {
			problem(w, 400, "Unsupported SSH credential type")
			return
		}
	case "windows":
		if authType != "password" {
			problem(w, 400, "RDP requires password authentication")
			return
		}
		port := integer(asset["rdp_port"])
		if port < 1 || port > 65535 {
			problem(w, 400, "RDP is disabled for this asset")
			return
		}
		protocol = "rdp"
		settings["port"] = strconv.FormatInt(port, 10)
		settings["password"] = string(secret)
		settings["security"] = "nla"
		settings["ignore-cert"] = "false"
		settings["resize-method"] = "display-update"
		settings["width"] = strconv.Itoa(in.Width)
		settings["height"] = strconv.Itoa(in.Height)
	default:
		problem(w, 400, "Unsupported asset OS")
		return
	}
	token, err := security.GuacamoleToken(s.Config.GuacKey, map[string]any{"type": protocol, "settings": settings})
	delete(settings, "password")
	delete(settings, "private-key")
	if err != nil {
		problem(w, 503, "Cannot issue remote session token")
		return
	}
	expires := time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)
	doc := map[string]any{"id": id, "asset_id": in.AssetID, "asset_name": asset["name"], "protocol": protocol, "operator": current(r).Username, "operator_id": current(r).ID, "started_at": now(), "ended_at": nil, "token_hash": security.Digest(token), "token_expires_at": time.Now().UTC().Add(time.Minute).Format(time.RFC3339Nano), "expires_at": expires, "connection_status": "issued", "revoked": false}
	if err := s.Store.Put(r.Context(), "sessions", id, doc); err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "session.open", strconv.FormatInt(in.AssetID, 10), true, protocol)
	writeJSON(w, 201, map[string]any{"id": id, "asset_name": asset["name"], "protocol": protocol, "token": token, "expires_at": expires, "termination_supported": true})
}

func (s *Server) featureSessionAllowed(r *http.Request, doc map[string]any) bool {
	return current(r).Role == "admin" || integer(doc["operator_id"]) == current(r).ID
}

// OpenRoot confines the read to the configured shared volume, including symlink resolution.
func (s *Server) featureRecordingOpen(id string) (*os.File, error) {
	if !featureSessionID.MatchString(id) || s.Config.RecordingsDir == "" {
		return nil, fs.ErrNotExist
	}
	root, err := os.OpenRoot(s.Config.RecordingsDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.Open(filepath.Join(id, "session.guac"))
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() {
		file.Close()
		return nil, fs.ErrNotExist
	}
	return file, nil
}

func (s *Server) featureSessionOut(doc map[string]any) (map[string]any, error) {
	file, err := s.featureRecordingOpen(text(doc["id"]))
	has := err == nil
	if has {
		file.Close()
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	out := map[string]any{"has_recording": has, "termination_supported": true}
	for _, key := range []string{"id", "asset_id", "asset_name", "protocol", "operator", "started_at", "ended_at"} {
		out[key] = doc[key]
	}
	for _, key := range []string{"connection_status", "expires_at", "revoked"} {
		out[key] = doc[key]
	}
	return out, nil
}

func (s *Server) featureSessions(w http.ResponseWriter, r *http.Request) {
	docs, err := s.Store.List(r.Context(), "sessions")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	out := []map[string]any{}
	for _, doc := range docs {
		if !s.featureSessionAllowed(r, doc) {
			continue
		}
		item, err := s.featureSessionOut(doc)
		if err != nil {
			problem(w, 500, "Cannot inspect session recording")
			return
		}
		out = append(out, item)
		if len(out) >= limit(r, 500) {
			break
		}
	}
	writeJSON(w, 200, out)
}

func (s *Server) featureEndSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !featureSessionID.MatchString(id) {
		problem(w, 404, "Session not found")
		return
	}
	doc, err := s.Store.Get(r.Context(), "sessions", id)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	if !s.featureSessionAllowed(r, doc) {
		problem(w, 403, "Session belongs to another operator")
		return
	}
	// Revoke durably before calling the bridge, so racing/new authorizations fail closed.
	if _, err := s.DB.ExecContext(r.Context(), `UPDATE documents SET data=data || '{"revoked":true,"connection_status":"termination_requested"}'::jsonb WHERE collection='sessions' AND id=$1`, id); err != nil {
		s.databaseError(w, err)
		return
	}
	if err := s.featureBridgeEnd(r.Context(), id); err != nil {
		s.audit(r, "session.end", id, false, "Bridge termination not confirmed; access revoked")
		problem(w, 503, "Session access revoked; bridge termination has not been confirmed")
		return
	}
	patch, _ := json.Marshal(map[string]any{"ended_at": now(), "connection_status": "terminated", "end_kind": "bridge_confirmed"})
	if _, err := s.DB.ExecContext(r.Context(), `UPDATE documents SET data=data || $2::jsonb WHERE collection='sessions' AND id=$1`, id, patch); err != nil {
		s.databaseError(w, err)
		return
	}
	doc, err = s.Store.Get(r.Context(), "sessions", id)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "session.end", id, true, "Bridge confirmed disconnect")
	out, err := s.featureSessionOut(doc)
	if err != nil {
		problem(w, 500, "Cannot inspect session recording")
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) featureRecording(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !featureSessionID.MatchString(id) {
		problem(w, 404, "Session not found")
		return
	}
	doc, err := s.Store.Get(r.Context(), "sessions", id)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	if !s.featureSessionAllowed(r, doc) {
		problem(w, 403, "Session belongs to another operator")
		return
	}
	file, err := s.featureRecordingOpen(id)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			problem(w, 404, "No recording for this session")
		} else {
			problem(w, 500, "Cannot read session recording")
		}
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		problem(w, 500, "Cannot read session recording")
		return
	}
	s.audit(r, "session.recording", id, true, "")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="session.guac"`)
	http.ServeContent(w, r, "session.guac", info.ModTime(), file)
}

// sessionControlRoutes is intentionally outside /api: only the bridge calls it with a shared key.
func (s *Server) sessionControlRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /internal/guac/authorize", s.featureControlAuth(s.featureSessionAuthorize))
	mux.HandleFunc("GET /internal/guac/sessions/{id}", s.featureControlAuth(s.featureSessionStatus))
	mux.HandleFunc("POST /internal/guac/sessions/{id}/closed", s.featureControlAuth(s.featureSessionClosed))
}

func (s *Server) featureControlAuth(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		configured := s.Config.SessionControlKey
		presented := r.Header.Get("X-Guac-Control-Key")
		if len(configured) < 32 || len(presented) > 512 || subtle.ConstantTimeCompare([]byte(security.Digest(presented)), []byte(security.Digest(configured))) != 1 {
			problem(w, 403, "Bridge authorization required")
			return
		}
		handler(w, r)
	}
}

func featureSessionLive(doc map[string]any) bool {
	expires, err := time.Parse(time.RFC3339Nano, text(doc["expires_at"]))
	revoked, _ := doc["revoked"].(bool)
	return err == nil && time.Now().Before(expires) && !revoked && doc["ended_at"] == nil
}

func (s *Server) featureSessionUserActive(ctx context.Context, doc map[string]any) bool {
	var active bool
	err := s.DB.QueryRowContext(ctx, "SELECT active AND NOT must_change_password AND role IN ('operator','admin') FROM users WHERE id=$1", integer(doc["operator_id"])).Scan(&active)
	return err == nil && active
}

func (s *Server) featureSessionAuthorize(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Hash string `json:"token_hash"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Hash) != 64 {
		problem(w, 403, "Invalid session token")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var raw []byte
	err = tx.QueryRowContext(r.Context(), `SELECT data FROM documents WHERE collection='sessions' AND data->>'token_hash'=$1 FOR UPDATE`, in.Hash).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			problem(w, 403, "Invalid session token")
		} else {
			s.databaseError(w, err)
		}
		return
	}
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		problem(w, 500, "Invalid stored session")
		return
	}
	var userActive bool
	userErr := tx.QueryRowContext(r.Context(), "SELECT active AND NOT must_change_password AND role IN ('operator','admin') FROM users WHERE id=$1", integer(doc["operator_id"])).Scan(&userActive)
	expires, err := time.Parse(time.RFC3339Nano, text(doc["token_expires_at"]))
	if err != nil || !time.Now().Before(expires) || doc["consumed_at"] != nil || !featureSessionLive(doc) || userErr != nil || !userActive {
		problem(w, 403, "Session token expired, consumed or revoked")
		return
	}
	patch, _ := json.Marshal(map[string]any{"consumed_at": now(), "connection_status": "authorized"})
	_, err = tx.ExecContext(r.Context(), `UPDATE documents SET data=data || $2::jsonb WHERE collection='sessions' AND id=$1`, text(doc["id"]), patch)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"id": doc["id"], "expires_at": doc["expires_at"]})
}

func (s *Server) featureSessionStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !featureSessionID.MatchString(id) {
		problem(w, 403, "Invalid session")
		return
	}
	doc, err := s.Store.Get(r.Context(), "sessions", id)
	if err != nil {
		problem(w, 403, "Session unavailable")
		return
	}
	if !featureSessionLive(doc) || doc["consumed_at"] == nil || !s.featureSessionUserActive(r.Context(), doc) {
		problem(w, 403, "Session revoked or expired")
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "expires_at": doc["expires_at"]})
}

func (s *Server) featureSessionClosed(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !featureSessionID.MatchString(id) {
		problem(w, 400, "Invalid session")
		return
	}
	patch, _ := json.Marshal(map[string]any{"ended_at": now(), "connection_status": "disconnected", "end_kind": "bridge_closed"})
	if _, err := s.DB.ExecContext(r.Context(), `UPDATE documents SET data=CASE WHEN data->>'ended_at' IS NULL THEN data || $2::jsonb ELSE data END WHERE collection='sessions' AND id=$1`, id, patch); err != nil {
		s.databaseError(w, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) featureBridgeEnd(ctx context.Context, id string) error {
	if len(s.Config.SessionControlKey) < 32 {
		return errors.New("bridge control is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	// Fixed private service address: no request field can redirect the authenticated control call.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://guac-tunnel:8080/internal/end/"+id, bytes.NewReader([]byte("{}")))
	if err != nil {
		return err
	}
	req.Header.Set("X-Guac-Control-Key", s.Config.SessionControlKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("bridge termination unavailable")
	}
	defer resp.Body.Close()
	var result struct {
		Terminated bool `json:"terminated"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&result) != nil || !result.Terminated {
		return errors.New("bridge termination not confirmed")
	}
	return nil
}
