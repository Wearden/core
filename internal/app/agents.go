package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/Wearden/core/internal/security"
	"github.com/Wearden/proto/wire"
	"net/http"
	"regexp"
	"time"
)

type agent struct {
	ID                                 string
	AssetID                            int64
	Hostname, OS, Version, BenchmarkID string
	Interval                           int
	Seen                               *time.Time
}

func (s *Server) agentIdentity(r *http.Request) (agent, error) {
	var a agent
	token := bearer(r)
	if token == "" {
		return a, sql.ErrNoRows
	}
	err := s.DB.QueryRowContext(r.Context(), "SELECT id,asset_id,hostname,os,version,benchmark_id,interval_seconds,last_seen FROM agents WHERE token_hash=$1 AND NOT revoked", digest(token)).Scan(&a.ID, &a.AssetID, &a.Hostname, &a.OS, &a.Version, &a.BenchmarkID, &a.Interval, &a.Seen)
	return a, err
}
func (s *Server) agentRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /api/agent/v1/enroll", s.enroll)
	m.HandleFunc("POST /api/agent/v1/heartbeat", s.heartbeat)
	m.HandleFunc("GET /api/agent/v1/config", s.agentConfig)
	m.HandleFunc("GET /api/agent/v1/ruleset", s.agentRuleset)
	m.HandleFunc("POST /api/agent/v1/reports", s.ingestReport)
	m.HandleFunc("POST /api/agents/enrollment-tokens", s.require("admin", s.enrollmentToken))
	m.HandleFunc("GET /api/agents", s.require("viewer", s.listAgents))
	m.HandleFunc("POST /api/agents/{id}/revoke", s.require("admin", func(w http.ResponseWriter, r *http.Request) {
		tx, err := s.DB.BeginTx(r.Context(), nil)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer tx.Rollback()
		result, err := tx.ExecContext(r.Context(), "UPDATE agents SET revoked=true WHERE id=$1", r.PathValue("id"))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			problem(w, 404, "Agent not found")
			return
		}
		_, err = tx.ExecContext(r.Context(), "UPDATE agent_jobs SET state='cancelled' WHERE agent_id=$1 AND state='queued'", r.PathValue("id"))
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "agent.revoked", r.PathValue("id"), true, "")
		w.WriteHeader(204)
	}))
}
func (s *Server) enrollmentToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OS        string `json:"os"`
		Benchmark string `json:"benchmark_id"`
		TTL       int    `json:"ttl_minutes"`
	}
	if !decode(w, r, &in) {
		return
	}
	b := s.Catalog[in.Benchmark]
	if b == nil || len(b.Native) == 0 || b.OS != in.OS || in.TTL < 1 || in.TTL > 1440 {
		problem(w, 400, "Select a native benchmark matching the OS and a TTL of 1..1440 minutes")
		return
	}
	token, err := security.Random()
	if err != nil {
		problem(w, 500, "Cannot generate enrollment token")
		return
	}
	expires := time.Now().UTC().Add(time.Duration(in.TTL) * time.Minute)
	_, err = s.DB.ExecContext(r.Context(), "INSERT INTO enrollment_tokens(hash,os,benchmark_id,expires_at,created_by) VALUES($1,$2,$3,$4,$5)", digest(token), in.OS, in.Benchmark, expires, current(r).Username)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "agent.enrollment_token_created", in.Benchmark, true, "")
	writeJSON(w, 201, map[string]any{"token": token, "expires_at": expires})
}

var enrollmentRequestID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (s *Server) enroll(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var in wire.Enrollment
	if !decode(w, r, &in) {
		return
	}
	if in.Version != wire.Version || !hostnameRE.MatchString(in.Hostname) || (in.OS != "linux" && in.OS != "windows") || in.AgentVersion == "" || len(in.AgentVersion) > 128 || (in.RequestID != "" && !enrollmentRequestID.MatchString(in.RequestID)) {
		problem(w, 400, "Invalid enrollment metadata")
		return
	}
	token := bearer(r)
	if token == "" {
		problem(w, 401, "Enrollment token required")
		return
	}
	id, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create identity")
		return
	}
	secret, err := security.Random()
	if err != nil {
		problem(w, 500, "Cannot create credential")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	var osName, bid string
	var expires time.Time
	var remaining int
	var priorRequest, priorDigest, priorAgent *string
	var enrolledAt *time.Time
	err = tx.QueryRowContext(r.Context(), "SELECT os,benchmark_id,expires_at,remaining,request_id,request_digest,agent_id,enrolled_at FROM enrollment_tokens WHERE hash=$1 FOR UPDATE", digest(token)).Scan(&osName, &bid, &expires, &remaining, &priorRequest, &priorDigest, &priorAgent, &enrolledAt)
	if err != nil || osName != in.OS {
		problem(w, 401, "Invalid enrollment token")
		return
	}
	requestBytes, e := json.Marshal(in)
	if e != nil {
		problem(w, 400, "Invalid enrollment request")
		return
	}
	requestDigest := digest(string(requestBytes))
	if remaining <= 0 {
		if in.RequestID == "" || priorRequest == nil || priorDigest == nil || priorAgent == nil || enrolledAt == nil || *priorRequest != in.RequestID || *priorDigest != requestDigest || time.Since(*enrolledAt) > 24*time.Hour {
			problem(w, 401, "Enrollment token already consumed")
			return
		}
		var storedHash string
		if tx.QueryRowContext(r.Context(), "SELECT token_hash FROM agents WHERE id=$1 AND NOT revoked", *priorAgent).Scan(&storedHash) != nil {
			problem(w, 403, "Enrolled identity is revoked or unavailable")
			return
		}
		recovered := security.DerivedAgentToken(token, in.RequestID, *priorAgent)
		if digest(recovered) != storedHash {
			problem(w, 403, "Enrollment credential has changed")
			return
		}
		writeJSON(w, 201, wire.EnrollmentResponse{AgentID: *priorAgent, AgentToken: recovered})
		return
	}
	if !time.Now().Before(expires) {
		problem(w, 401, "Enrollment token expired")
		return
	}
	if in.RequestID != "" {
		secret = security.DerivedAgentToken(token, in.RequestID, id)
	}
	data, _ := json.Marshal(map[string]any{"name": in.Hostname, "host": in.Hostname, "os_type": in.OS, "os_version": nil, "os_detected": nil, "privilege": nil, "ssh_port": 22, "rdp_port": 3389, "winrm_port": 5985, "winrm_https_port": 5986, "tags": []string{}, "status": "online", "latency_ms": nil, "last_seen": now(), "last_checked": now(), "credential_username": nil})
	var assetID int64
	err = tx.QueryRowContext(r.Context(), "INSERT INTO assets(data) VALUES($1) RETURNING id", data).Scan(&assetID)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO agents(id,asset_id,hostname,os,version,benchmark_id,token_hash,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,now())", id, assetID, in.Hostname, osName, in.AgentVersion, bid, digest(secret))
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE enrollment_tokens SET remaining=0,request_id=$1,request_digest=$2,agent_id=$3,enrolled_at=now() WHERE hash=$4", in.RequestID, requestDigest, id, digest(token))
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "agent.enrolled", id, true, "")
	writeJSON(w, 201, wire.EnrollmentResponse{AgentID: id, AgentToken: secret})
}
func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	a, err := s.agentIdentity(r)
	if err != nil {
		problem(w, 401, "Invalid agent credential")
		return
	}
	var in wire.Heartbeat
	if !decode(w, r, &in) {
		return
	}
	if in.Version != wire.Version || in.AgentID != a.ID || in.SentAt.IsZero() {
		problem(w, 400, "Invalid heartbeat identity or time")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), "UPDATE agents SET last_seen=now() WHERE id=$1 AND NOT revoked", a.ID)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `UPDATE assets SET data=data||jsonb_build_object('status','online','last_seen',now(),'last_checked',now()) WHERE id=$1`, a.AssetID)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO host_samples(asset_id,status) VALUES($1,'online')", a.AssetID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) assignment(ctx context.Context, a agent) ([]byte, string, error) {
	b := s.Catalog[a.BenchmarkID]
	if b == nil || len(b.Native) == 0 {
		return nil, "", errors.New("native benchmark assignment unavailable")
	}
	var scanID string
	var idsRaw []byte
	err := s.DB.QueryRowContext(ctx, "SELECT scan_id,rule_ids FROM agent_jobs WHERE agent_id=$1 AND state='queued' AND deadline>now() ORDER BY created_at,id LIMIT 1", a.ID).Scan(&scanID, &idsRaw)
	if err == sql.ErrNoRows {
		return append([]byte{}, b.Native...), "", nil
	}
	if err != nil {
		return nil, "", err
	}
	var ids []string
	if err = json.Unmarshal(idsRaw, &ids); err != nil {
		return nil, "", err
	}
	var manifest map[string]json.RawMessage
	if err = json.Unmarshal(b.Native, &manifest); err != nil {
		return nil, "", err
	}
	var all []map[string]json.RawMessage
	if err = json.Unmarshal(manifest["rules"], &all); err != nil {
		return nil, "", err
	}
	allowed := map[string]bool{}
	for _, id := range ids {
		allowed[id] = true
	}
	selected := []map[string]json.RawMessage{}
	for _, rule := range all {
		var id string
		if json.Unmarshal(rule["id"], &id) != nil {
			return nil, "", errors.New("invalid native rule")
		}
		if allowed[id] {
			selected = append(selected, rule)
		}
	}
	if len(selected) != len(ids) {
		return nil, "", errors.New("job contains unknown controls")
	}
	manifest["rules"], err = json.Marshal(selected)
	if err != nil {
		return nil, "", err
	}
	data, err := json.Marshal(manifest)
	return data, scanID, err
}
func (s *Server) agentConfig(w http.ResponseWriter, r *http.Request) {
	a, err := s.agentIdentity(r)
	if err != nil {
		problem(w, 401, "Invalid agent credential")
		return
	}
	data, scanID, err := s.assignment(r.Context(), a)
	if err != nil {
		problem(w, 409, "Agent assignment is unavailable")
		return
	}
	var meta struct {
		Version string `json:"ruleset_version"`
	}
	if json.Unmarshal(data, &meta) != nil {
		problem(w, 500, "Invalid assignment")
		return
	}
	writeJSON(w, 200, wire.Config{Version: wire.Version, ScanID: scanID, BenchmarkID: a.BenchmarkID, RulesetVersion: meta.Version, IntervalSeconds: a.Interval, RulesetSHA256: digest(string(data))})
}
func (s *Server) agentRuleset(w http.ResponseWriter, r *http.Request) {
	a, err := s.agentIdentity(r)
	if err != nil {
		problem(w, 401, "Invalid agent credential")
		return
	}
	data, _, err := s.assignment(r.Context(), a)
	if err != nil {
		problem(w, 409, "Agent assignment is unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}
func (s *Server) listAgents(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.QueryContext(r.Context(), "SELECT id,COALESCE(asset_id,0),hostname,os,version,benchmark_id,revoked,last_seen,"+agentHealthySQL+" FROM agents g ORDER BY created_at DESC")
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, hostname, osName, version, bid string
		var assetID int64
		var revoked, healthy bool
		var seen *time.Time
		if err = rows.Scan(&id, &assetID, &hostname, &osName, &version, &bid, &revoked, &seen, &healthy); err != nil {
			s.databaseError(w, err)
			return
		}
		status := "offline"
		if healthy {
			status = "online"
		}
		if revoked {
			status = "revoked"
		}
		out = append(out, map[string]any{"id": id, "asset_id": assetID, "hostname": hostname, "os": osName, "version": version, "benchmark_id": bid, "status": status, "last_seen": seen})
	}
	if rows.Err() != nil {
		s.databaseError(w, rows.Err())
		return
	}
	writeJSON(w, 200, out)
}

// Stable host and finding IDs remain numeric for the retained React clients.
func nextID(ctx context.Context, tx *sql.Tx, sequence string) (int64, error) {
	var id int64
	query := "SELECT nextval('host_result_ids')"
	if sequence == "finding" {
		query = "SELECT nextval('finding_ids')"
	}
	err := tx.QueryRowContext(ctx, query).Scan(&id)
	return id, err
}
