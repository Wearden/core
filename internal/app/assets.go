package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/Wearden/core/internal/security"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

var hostnameRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$`)

type assetInput struct {
	Name       string   `json:"name"`
	Host       string   `json:"host"`
	OS         string   `json:"os_type"`
	OSVersion  *string  `json:"os_version"`
	SSH        *int     `json:"ssh_port"`
	RDP        *int     `json:"rdp_port"`
	WinRM      *int     `json:"winrm_port"`
	WinRMHTTPS *int     `json:"winrm_https_port"`
	Tags       []string `json:"tags"`
	// "agent" (installed agent), "ssh" or "winrm" (PAM: managed over that connection without an agent).
	Connection string `json:"connection"`
}

const agentHealthySQL = `COALESCE(NOT g.revoked AND g.last_seen > now()-interval '3 minutes'
 AND g.last_seen <= now(),false)`

// All host views derive agent health from the same current heartbeat evidence.
const assetViewQuery = `SELECT a.id,
 a.data || jsonb_build_object('credential_username',c.username) ||
 CASE WHEN g.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
 'status',CASE WHEN ` + agentHealthySQL + ` THEN 'online' ELSE 'offline' END,
 'last_seen',g.last_seen) END
 FROM assets a LEFT JOIN agents g ON g.asset_id=a.id
 LEFT JOIN credentials c ON c.asset_id=a.id`

func decodeAsset(id int64, raw []byte) (map[string]any, error) {
	var asset map[string]any
	if err := json.Unmarshal(raw, &asset); err != nil {
		return nil, err
	}
	asset["id"] = id
	return asset, nil
}

func (s *Server) asset(ctx context.Context, id int64) (map[string]any, error) {
	var actualID int64
	var raw []byte
	if err := s.DB.QueryRowContext(ctx, assetViewQuery+" WHERE a.id=$1", id).Scan(&actualID, &raw); err != nil {
		return nil, err
	}
	return decodeAsset(actualID, raw)
}
func (s *Server) assetList(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.DB.QueryContext(ctx, assetViewQuery+" ORDER BY a.id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		asset, err := decodeAsset(id, raw)
		if err != nil {
			return nil, err
		}
		out = append(out, asset)
	}
	return out, rows.Err()
}
func (s *Server) assetRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/assets", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.assetList(r.Context())
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, out)
	}))
	m.HandleFunc("GET /api/assets/{id}", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
		a, err := s.asset(r.Context(), id)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, a)
	}))
	m.HandleFunc("POST /api/assets", s.require("operator", s.saveAsset))
	m.HandleFunc("PUT /api/assets/{id}", s.require("operator", s.saveAsset))
	m.HandleFunc("DELETE /api/assets/{id}", s.requirePerm("assets.delete", func(w http.ResponseWriter, r *http.Request) {
		tx, err := s.DB.BeginTx(r.Context(), nil)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer tx.Rollback()
		if _, err = tx.ExecContext(r.Context(), "UPDATE agents SET revoked=true WHERE asset_id=$1", r.PathValue("id")); err != nil {
			s.databaseError(w, err)
			return
		}
		if _, err = tx.ExecContext(r.Context(), "UPDATE agent_jobs SET state='cancelled' WHERE agent_id IN (SELECT id FROM agents WHERE asset_id=$1) AND state='queued'", r.PathValue("id")); err != nil {
			s.databaseError(w, err)
			return
		}
		result, err := tx.ExecContext(r.Context(), "DELETE FROM assets WHERE id=$1", r.PathValue("id"))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			problem(w, 404, "Asset not found")
			return
		}
		if err = tx.Commit(); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "asset.deleted", r.PathValue("id"), true, "")
		w.WriteHeader(204)
	}))
	m.HandleFunc("PUT /api/assets/{id}/credential", s.requirePerm("credentials.manage", s.setCredential))
	m.HandleFunc("DELETE /api/assets/{id}/credential", s.requirePerm("credentials.manage", func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.DB.ExecContext(r.Context(), "DELETE FROM credentials WHERE asset_id=$1", r.PathValue("id")); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "credential.deleted", r.PathValue("id"), true, "")
		w.WriteHeader(204)
	}))
	m.HandleFunc("POST /api/assets/{id}/test", s.require("operator", func(w http.ResponseWriter, r *http.Request) {
		var healthy bool
		err := s.DB.QueryRowContext(r.Context(), "SELECT "+agentHealthySQL+" FROM agents g WHERE g.asset_id=$1", r.PathValue("id")).Scan(&healthy)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			s.databaseError(w, err)
			return
		}
		message := "No recent agent heartbeat"
		if healthy {
			message = "Agent heartbeat is current"
		}
		writeJSON(w, 200, map[string]any{"ok": healthy, "message": message, "os_detected": nil, "privilege": nil, "latency_ms": nil})
	}))
	m.HandleFunc("GET /api/assets/{id}/history", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.DB.QueryContext(r.Context(), "SELECT checked_at,status FROM host_samples WHERE asset_id=$1 ORDER BY checked_at DESC LIMIT $2", r.PathValue("id"), limit(r, 1000))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var at time.Time
			var status string
			if err = rows.Scan(&at, &status); err != nil {
				s.databaseError(w, err)
				return
			}
			out = append(out, map[string]any{"checked_at": at, "status": status, "latency_ms": nil})
		}
		if rows.Err() != nil {
			s.databaseError(w, rows.Err())
			return
		}
		writeJSON(w, 200, out)
	}))
}
func (s *Server) saveAsset(w http.ResponseWriter, r *http.Request) {
	var in assetInput
	if !decode(w, r, &in) {
		return
	}
	if len(in.Name) < 1 || len(in.Name) > 100 || (net.ParseIP(in.Host) == nil && !hostnameRE.MatchString(in.Host)) || (in.OS != "linux" && in.OS != "windows") || len(in.Tags) > 10 {
		problem(w, 400, "Invalid asset name, host, OS or tags")
		return
	}
	for _, p := range []*int{in.SSH, in.RDP, in.WinRM, in.WinRMHTTPS} {
		if p != nil && (*p < 1 || *p > 65535) {
			problem(w, 400, "Invalid port")
			return
		}
	}
	for _, tag := range in.Tags {
		if len(tag) > 32 {
			problem(w, 400, "Tag exceeds 32 bytes")
			return
		}
	}
	if in.Tags == nil {
		in.Tags = []string{}
	}
	if in.Connection != "" && !validConnection(in.OS, in.Connection) {
		problem(w, 400, "Connection must be agent or ssh, or winrm for Windows")
		return
	}
	a := map[string]any{"name": in.Name, "host": in.Host, "os_type": in.OS, "os_version": in.OSVersion, "ssh_port": in.SSH, "rdp_port": in.RDP, "winrm_port": in.WinRM, "winrm_https_port": in.WinRMHTTPS, "tags": in.Tags, "status": "unknown", "latency_ms": nil, "last_seen": nil, "last_checked": nil, "os_detected": nil, "privilege": nil, "credential_username": nil}
	a["connection"] = in.Connection
	if in.Connection == "" {
		a["connection"] = "agent"
	}
	id := int64(0)
	code := 201
	if r.PathValue("id") != "" {
		id, _ = strconv.ParseInt(r.PathValue("id"), 10, 64)
		old, err := s.asset(r.Context(), id)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		for _, key := range []string{"status", "latency_ms", "last_seen", "last_checked", "os_detected", "privilege"} {
			a[key] = old[key]
		}
		if in.Connection == "" {
			a["connection"] = assetConnection(old)
		}
		code = 200
	}
	data, err := json.Marshal(a)
	if err != nil {
		problem(w, 400, "Invalid asset")
		return
	}
	if id == 0 {
		err = s.DB.QueryRowContext(r.Context(), "INSERT INTO assets(data) VALUES($1) RETURNING id", data).Scan(&id)
	} else {
		_, err = s.DB.ExecContext(r.Context(), "UPDATE assets SET data=$1 WHERE id=$2", data, id)
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	a["id"] = id
	s.audit(r, "asset.saved", strconv.FormatInt(id, 10), true, "")
	writeJSON(w, code, a)
}
func (s *Server) setCredential(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		AuthType string `json:"auth_type"`
		Secret   string `json:"secret"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Username == "" || len(in.Username) > 255 || len(in.Secret) == 0 || len(in.Secret) > 16000 || (in.AuthType != "password" && in.AuthType != "ssh_key") {
		problem(w, 400, "Invalid credential")
		return
	}
	sealed, err := security.Seal(s.Config.VaultKey, []byte(in.Secret))
	if err != nil {
		problem(w, 503, "Credential vault is not configured")
		return
	}
	_, err = s.DB.ExecContext(r.Context(), "INSERT INTO credentials(asset_id,username,auth_type,encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(asset_id) DO UPDATE SET username=excluded.username,auth_type=excluded.auth_type,encrypted=excluded.encrypted", r.PathValue("id"), in.Username, in.AuthType, sealed)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "credential.saved", r.PathValue("id"), true, "")
	w.WriteHeader(204)
}
