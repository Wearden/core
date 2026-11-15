package app

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/Wearden/core/internal/security"
)

type scheduleInput struct {
	Name          string  `json:"name"`
	Benchmark     string  `json:"benchmark_id"`
	Profile       string  `json:"profile_id"`
	AssetIDs      []int64 `json:"asset_ids"`
	IntervalHours int     `json:"interval_hours"`
	DropThreshold float64 `json:"drop_threshold"`
	WebhookURL    *string `json:"webhook_url"`
}

type scheduleRecord struct {
	scheduleInput
	ID              string     `json:"id"`
	Enabled         bool       `json:"enabled"`
	CreatedBy       string     `json:"created_by"`
	CreatedAt       time.Time  `json:"created_at"`
	LastRunAt       *time.Time `json:"last_run_at"`
	LastScore       *float64   `json:"last_score"`
	LastError       *string    `json:"last_error"`
	LastScanID      string     `json:"last_scan_id,omitempty"`
	EvaluatedScanID string     `json:"evaluated_scan_id,omitempty"`
	LastAttemptAt   *time.Time `json:"last_attempt_at,omitempty"`
	NextRun         time.Time  `json:"next_run"`
}

func (s *Server) scheduleRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/schedules", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.DB.QueryContext(r.Context(), "SELECT id,data,next_run,last_error FROM scan_schedules ORDER BY created_at DESC,id")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer rows.Close()
		out := []scheduleRecord{}
		for rows.Next() {
			var item scheduleRecord
			var raw []byte
			if err := rows.Scan(&item.ID, &raw, &item.NextRun, &item.LastError); err != nil {
				s.databaseError(w, err)
				return
			}
			id, next, lastError := item.ID, item.NextRun, item.LastError
			if err := json.Unmarshal(raw, &item); err != nil {
				s.databaseError(w, err)
				return
			}
			item.ID, item.NextRun, item.LastError = id, next, lastError
			out = append(out, item)
		}
		if err := rows.Err(); err != nil {
			s.databaseError(w, err)
			return
		}
		writeJSON(w, 200, out)
	}))
	m.HandleFunc("POST /api/schedules", s.require("operator", func(w http.ResponseWriter, r *http.Request) {
		in := scheduleInput{IntervalHours: 24, DropThreshold: 5}
		if !decode(w, r, &in) {
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if in.Name == "" || len(in.Name) > 120 || len(in.Benchmark) < 1 || len(in.Benchmark) > 64 || len(in.Profile) < 1 || len(in.Profile) > 64 || len(in.AssetIDs) < 1 || len(in.AssetIDs) > 200 || in.IntervalHours < 1 || in.IntervalHours > 720 || math.IsNaN(in.DropThreshold) || math.IsInf(in.DropThreshold, 0) || in.DropThreshold < 0.5 || in.DropThreshold > 100 {
			problem(w, 400, "Invalid schedule fields")
			return
		}
		if in.WebhookURL != nil {
			if *in.WebhookURL == "" {
				in.WebhookURL = nil
			} else if _, err := webhookAddress(*in.WebhookURL); err != nil {
				problem(w, 400, err.Error())
				return
			}
		}
		ids, err := s.selectControls(r, in.Benchmark, in.Profile)
		if err != nil || len(ids) == 0 {
			problem(w, 400, "Unknown benchmark or profile")
			return
		}
		b := s.Catalog[in.Benchmark]
		if b == nil {
			problem(w, 404, "Benchmark not found")
			return
		}
		seen := map[int64]bool{}
		assets := []int64{}
		for _, id := range in.AssetIDs {
			if id < 1 {
				problem(w, 400, "Invalid asset identity")
				return
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			var native, osName string
			err = s.DB.QueryRowContext(r.Context(), "SELECT benchmark_id,os FROM agents WHERE asset_id=$1 AND NOT revoked", id).Scan(&native, &osName)
			if errors.Is(err, sql.ErrNoRows) {
				problem(w, 400, "Every scheduled asset must have an enrolled agent")
				return
			}
			if err != nil {
				s.databaseError(w, err)
				return
			}
			nb := s.Catalog[native]
			if nb == nil || osName != b.OS || (native != in.Benchmark && originalBenchmark(native) != in.Benchmark) {
				problem(w, 400, "Asset benchmark assignment does not match schedule")
				return
			}
			for _, control := range ids {
				if _, ok := nb.Controls[control]; !ok {
					problem(w, 400, "An asset does not support the selected profile")
					return
				}
			}
			assets = append(assets, id)
		}
		sort.Slice(assets, func(i, j int) bool { return assets[i] < assets[j] })
		in.AssetIDs = assets
		id, err := security.ID()
		if err != nil {
			problem(w, 500, "Cannot create schedule identity")
			return
		}
		at := time.Now().UTC()
		record := scheduleRecord{scheduleInput: in, ID: id, Enabled: true, CreatedBy: current(r).Username, CreatedAt: at, NextRun: at}
		raw, err := json.Marshal(record)
		if err == nil {
			_, err = s.DB.ExecContext(r.Context(), "INSERT INTO scan_schedules(id,data,next_run) VALUES($1,$2,$3)", id, raw, at)
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "schedule.create", id, true, fmt.Sprintf("every %d h", in.IntervalHours))
		writeJSON(w, 201, record)
	}))
	m.HandleFunc("DELETE /api/schedules/{id}", s.require("operator", func(w http.ResponseWriter, r *http.Request) {
		result, err := s.DB.ExecContext(r.Context(), "DELETE FROM scan_schedules WHERE id=$1", r.PathValue("id"))
		if err != nil {
			s.databaseError(w, err)
			return
		}
		n, err := result.RowsAffected()
		if err != nil {
			s.databaseError(w, err)
			return
		}
		if n == 0 {
			problem(w, 404, "Schedule not found")
			return
		}
		s.audit(r, "schedule.delete", r.PathValue("id"), true, "")
		w.WriteHeader(204)
	}))
}

func webhookAddress(address string) (*url.URL, error) {
	u, err := url.Parse(address)
	if err != nil || len(address) > 500 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") || strings.ContainsAny(address, "\r\n") {
		return nil, errors.New("Webhook must be an HTTPS URL on port 443 without userinfo or fragment")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !publicWebhookIP(ip) {
		return nil, errors.New("Webhook requires a public destination")
	}
	return u, nil
}

func publicWebhookIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.Zone() != "" || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	// Deny non-public special-use and transition ranges, including embedded IPv4 routes.
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "::/96", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20", "fc00::/7", "fe80::/10"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return ip.Is4() || netip.MustParsePrefix("2000::/3").Contains(ip)
}

func sendScheduleAlert(ctx context.Context, address string, before, after float64) error {
	u, err := webhookAddress(address)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", u.Hostname())
	if err != nil || len(addresses) == 0 {
		return errors.New("Webhook public DNS resolution failed")
	}
	for _, ip := range addresses {
		if !publicWebhookIP(ip) {
			return errors.New("Webhook DNS includes a non-public address")
		}
	}
	pinned := addresses[0].Unmap()
	transport := &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: u.Hostname()}, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 5 * time.Second, DisableKeepAlives: true, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(pinned.String(), "443"))
	}}
	defer transport.CloseIdleConnections()
	body, err := json.Marshal(map[string]string{"text": fmt.Sprintf("Wearden scheduled compliance dropped from %.1f%% to %.1f%%.", before, after)})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return errors.New("Cannot create webhook request")
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("Webhook delivery failed")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("Webhook rejected alert: HTTP %d", res.StatusCode)
	}
	_, err = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if err != nil {
		return errors.New("Webhook response read failed")
	}
	return nil
}

func scheduleTerminal(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled"
}

func (s *Server) evaluateSchedule(ctx context.Context, tx *sql.Tx, record *scheduleRecord) (bool, error) {
	if record.LastScanID == "" || record.EvaluatedScanID == record.LastScanID {
		return false, nil
	}
	var raw []byte
	if err := tx.QueryRowContext(ctx, "SELECT data FROM documents WHERE collection='scans' AND id=$1", record.LastScanID).Scan(&raw); err != nil {
		return false, err
	}
	var scan map[string]any
	if err := json.Unmarshal(raw, &scan); err != nil {
		return false, err
	}
	if !scheduleTerminal(text(scan["status"])) {
		return true, nil
	}
	var sum float64
	count := 0
	for _, host := range featureMaps(scan["hosts"]) {
		if score, ok := featureNumber(host["score"]); ok && score >= 0 && score <= 100 {
			sum += score
			count++
		}
	}
	if count > 0 {
		score := sum / float64(count)
		if record.LastScore != nil && *record.LastScore-score >= record.DropThreshold && record.WebhookURL != nil {
			if err := sendScheduleAlert(ctx, *record.WebhookURL, *record.LastScore, score); err != nil {
				return false, err
			}
		}
		record.LastScore = &score
	}
	record.EvaluatedScanID = record.LastScanID
	return false, nil
}

func (s *Server) processSchedule(ctx context.Context) (bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var id string
	var raw []byte
	var due time.Time
	err = tx.QueryRowContext(ctx, `SELECT id,data,next_run FROM scan_schedules WHERE COALESCE((data->>'enabled')::boolean,true) AND (next_run<=now() OR COALESCE(data->>'last_scan_id','')<>COALESCE(data->>'evaluated_scan_id','')) AND (data->>'last_attempt_at' IS NULL OR (data->>'last_attempt_at')::timestamptz<now()-interval '1 minute') ORDER BY next_run,id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id, &raw, &due)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var record scheduleRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		_, saveErr := tx.ExecContext(ctx, `UPDATE scan_schedules SET last_error='Stored schedule data is invalid',data=data||jsonb_build_object('last_attempt_at',now()) WHERE id=$1`, id)
		if saveErr == nil {
			saveErr = tx.Commit()
		}
		slog.Error("stored schedule data is invalid", "schedule_id", id)
		return true, saveErr
	}
	record.ID = id
	record.NextRun = due
	at := time.Now().UTC()
	record.LastAttemptAt = &at
	busy, workErr := s.evaluateSchedule(ctx, tx, &record)
	if workErr == nil && !busy && !due.After(at) {
		if record.IntervalHours < 1 || record.IntervalHours > 720 {
			workErr = errors.New("Stored schedule interval is invalid")
		} else {
			var scanID string
			err = tx.QueryRowContext(ctx, `SELECT id FROM documents WHERE collection='scans' AND data->>'created_by'=$1 AND created_at>=$2 ORDER BY created_at,id LIMIT 1`, "schedule:"+id, due).Scan(&scanID)
			if errors.Is(err, sql.ErrNoRows) {
				var scan map[string]any
				scan, workErr = s.queueScan(ctx, scanInput{Name: record.Name, Benchmark: record.Benchmark, Profile: record.Profile, AssetIDs: record.AssetIDs}, "schedule:"+id)
				if workErr == nil {
					scanID = text(scan["id"])
				}
			} else if err != nil {
				workErr = err
			}
			if workErr == nil {
				record.LastScanID = scanID
				record.LastRunAt = &at
				interval := time.Duration(record.IntervalHours) * time.Hour
				record.NextRun = due.Add((at.Sub(due)/interval + 1) * interval)
			}
		}
	}
	if workErr != nil {
		message := workErr.Error()
		if len(message) > 500 {
			message = message[:500]
		}
		record.LastError = &message
		slog.Warn("scheduled scan operation failed", "schedule_id", id)
	} else if !busy {
		record.LastError = nil
	}
	raw, err = json.Marshal(record)
	if err == nil {
		_, err = tx.ExecContext(ctx, "UPDATE scan_schedules SET data=$1,next_run=$2,last_error=$3 WHERE id=$4", raw, record.NextRun, record.LastError, id)
	}
	if err == nil {
		err = tx.Commit()
	}
	return true, err
}

func (s *Server) expireScanJobs(ctx context.Context) error {
	for n := 0; n < 100; n++ {
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		var id string
		var raw []byte
		err = tx.QueryRowContext(ctx, `SELECT d.id,d.data FROM documents d WHERE d.collection='scans' AND EXISTS(SELECT 1 FROM agent_jobs j WHERE j.scan_id=d.id AND j.state='queued' AND j.deadline<=now()) ORDER BY d.created_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`).Scan(&id, &raw)
		if errors.Is(err, sql.ErrNoRows) {
			tx.Rollback()
			return nil
		}
		if err != nil {
			tx.Rollback()
			return err
		}
		var doc map[string]any
		if err = json.Unmarshal(raw, &doc); err != nil {
			tx.Rollback()
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE agent_jobs SET state='expired' WHERE scan_id=$1 AND state='queued' AND deadline<=now()", id)
		if err == nil && !scheduleTerminal(text(doc["status"])) {
			// Once a required host misses its deadline, the aggregate scan cannot complete successfully.
			doc["status"], doc["finished_at"], doc["message"] = "failed", now(), "One or more agent jobs exceeded the 24-hour delivery deadline"
			for _, host := range featureMaps(doc["hosts"]) {
				if !scheduleTerminal(text(host["status"])) {
					host["status"], host["message"] = "failed", "Scan delivery deadline exceeded"
				}
			}
			raw, err = json.Marshal(doc)
			if err == nil {
				_, err = tx.ExecContext(ctx, "UPDATE documents SET data=$1 WHERE collection='scans' AND id=$2", raw, id)
			}
			if err == nil {
				_, err = tx.ExecContext(ctx, "UPDATE agent_jobs SET state='cancelled' WHERE scan_id=$1 AND state='queued'", id)
			}
		}
		if err == nil {
			err = tx.Commit()
		} else {
			tx.Rollback()
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) RunWorker(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		cycle, cancel := context.WithTimeout(ctx, 45*time.Second)
		if _, err := s.DB.ExecContext(cycle, "DELETE FROM user_tokens WHERE expires_at<=now()"); err != nil && cycle.Err() == nil {
			slog.Error("expired user token cleanup failed")
		}
		if _, err := s.DB.ExecContext(cycle, `UPDATE assets x SET data=x.data||jsonb_build_object('status','offline','last_checked',now(),'latency_ms',NULL) FROM agents a WHERE a.asset_id=x.id AND (a.revoked OR a.last_seen IS NULL OR a.last_seen<now()-interval '3 minutes') AND COALESCE(x.data->>'status','')<>'offline'`); err != nil && cycle.Err() == nil {
			slog.Error("stale agent status update failed")
		}
		if err := s.expireActions(cycle); err != nil && cycle.Err() == nil {
			slog.Error("action job expiry failed")
		}
		if err := s.expireScanJobs(cycle); err != nil && cycle.Err() == nil {
			slog.Error("agent job expiry failed")
		}
		for n := 0; n < 16 && cycle.Err() == nil; n++ {
			found, err := s.processSchedule(cycle)
			if err != nil {
				slog.Error("schedule worker transaction failed")
				break
			}
			if !found {
				break
			}
		}
		if cycle.Err() != nil && ctx.Err() == nil {
			slog.Warn("background worker cycle timed out")
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
