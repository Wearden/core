package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/websocket"
)

var streamSlots = make(chan struct{}, 64)
var errStreamDenied = errors.New("stream access denied")

func streamAuthCode(err error) int {
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, errStreamDenied) {
		return 1008
	}
	return 1011
}

func streamOrigin(r *http.Request) error {
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") || (origin.Scheme != "http" && origin.Scheme != "https") || !strings.EqualFold(origin.Host, r.Host) {
		return errors.New("WebSocket origin must match request Host")
	}
	if r.TLS != nil && origin.Scheme != "https" {
		return errors.New("WebSocket origin scheme does not match TLS")
	}
	return nil
}

func (s *Server) websocketRoutes(m *http.ServeMux) {
	for _, route := range []struct{ pattern, collection, role string }{{"GET /ws/hosts", "assets", "viewer"}, {"GET /ws/scans/{id}", "scans", "viewer"}, {"GET /ws/hardening/{id}", "hardening", "operator"}} {
		route := route
		m.HandleFunc(route.pattern, func(w http.ResponseWriter, r *http.Request) {
			if err := streamOrigin(r); err != nil {
				problem(w, 403, "WebSocket origin denied")
				return
			}
			if s.Config.AllowedOrigin != "" && r.Header.Get("Origin") != s.Config.AllowedOrigin {
				problem(w, 403, "WebSocket origin denied")
				return
			}
			if len(r.PathValue("id")) > 128 {
				problem(w, 400, "Invalid stream identifier")
				return
			}
			if _, ok := w.(http.Hijacker); !ok {
				problem(w, 400, "WebSocket upgrade requires HTTP/1.1")
				return
			}
			select {
			case streamSlots <- struct{}{}:
				defer func() { <-streamSlots }()
			default:
				problem(w, 503, "Too many live streams")
				return
			}
			server := websocket.Server{Handshake: func(_ *websocket.Config, r *http.Request) error { return streamOrigin(r) }, Handler: func(conn *websocket.Conn) { s.serveStream(conn, route.collection, route.role, r.PathValue("id")) }}
			server.ServeHTTP(w, r)
		})
	}
}

func streamClose(conn *websocket.Conn, code int) {
	if conn.SetWriteDeadline(time.Now().Add(time.Second)) != nil {
		return
	}
	codec := websocket.Codec{Marshal: func(any) ([]byte, byte, error) { return []byte{byte(code >> 8), byte(code)}, websocket.CloseFrame, nil }}
	if err := codec.Send(conn, nil); err != nil {
		slog.Debug("websocket close frame failed")
	}
}

func streamSend(conn *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(data) > 8*1024*1024 {
		return errors.New("stream event exceeds payload limit")
	}
	if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	return websocket.Message.Send(conn, string(data))
}

func (s *Server) streamUser(ctx context.Context, token, required string) (User, string, error) {
	u, err := s.user(ctx, token)
	if err != nil {
		return u, "", err
	}
	ranks := map[string]int{"viewer": 1, "operator": 2, "admin": 3}
	if u.MustChange || ranks[u.Role] < ranks[required] {
		return u, "", errStreamDenied
	}
	var passwordVersion string
	err = s.DB.QueryRowContext(ctx, "SELECT password_hash FROM users WHERE id=$1 AND active", u.ID).Scan(&passwordVersion)
	return u, passwordVersion, err
}

func (s *Server) streamHosts(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.DB.QueryContext(ctx, assetViewQuery+" ORDER BY a.id LIMIT 2001")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		if len(out) >= 2000 {
			return nil, errors.New("host stream exceeds snapshot limit")
		}
		var id int64
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		var asset map[string]any
		if err := json.Unmarshal(raw, &asset); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "status": asset["status"], "latency_ms": asset["latency_ms"], "last_seen": asset["last_seen"], "last_checked": asset["last_checked"]})
	}
	return out, rows.Err()
}

func (s *Server) streamDocument(ctx context.Context, collection, id string) (map[string]any, error) {
	var raw []byte
	err := s.DB.QueryRowContext(ctx, `SELECT CASE WHEN octet_length(data::text)<=16777216 THEN data ELSE NULL END FROM documents WHERE collection=$1 AND id=$2`, collection, id).Scan(&raw)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, errors.New("document exceeds live stream size limit")
	}
	var doc map[string]any
	err = json.Unmarshal(raw, &doc)
	return doc, err
}

func (s *Server) serveStream(conn *websocket.Conn, collection, role, id string) {
	defer conn.Close()
	conn.MaxPayloadBytes = 4096
	if conn.SetDeadline(time.Now().Add(10*time.Second)) != nil {
		return
	}
	var auth struct {
		Type  string `json:"type"`
		Token string `json:"token"`
	}
	codec := websocket.Codec{Unmarshal: func(data []byte, frame byte, value any) error {
		if frame != websocket.TextFrame {
			return errors.New("authentication requires a JSON text frame")
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(value); err != nil {
			return err
		}
		if decoder.Decode(new(any)) != io.EOF {
			return errors.New("trailing authentication data")
		}
		return nil
	}}
	if err := codec.Receive(conn, &auth); err != nil || auth.Type != "auth" || auth.Token == "" || len(auth.Token) > 1024 {
		streamClose(conn, 1008)
		return
	}
	ctx, cancel := context.WithTimeout(conn.Request().Context(), 30*time.Minute)
	defer cancel()
	lookup, done := context.WithTimeout(ctx, 5*time.Second)
	user, passwordVersion, err := s.streamUser(lookup, auth.Token, role)
	done()
	if err != nil {
		streamClose(conn, streamAuthCode(err))
		return
	}
	// The browser sends no application messages after authentication. A bounded
	// reader still processes close/control frames and prevents an incoming flood.
	if conn.SetReadDeadline(time.Now().Add(30*time.Minute)) != nil {
		return
	}
	go func() {
		var extra string
		if err := websocket.Message.Receive(conn, &extra); err == nil {
			streamClose(conn, 1008)
		}
		cancel()
	}()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	initial := true
	cursor := 0
	lastStatus := ""
	// Events are sent only when something changed, so a finished scan or run stays
	// quiet instead of repeating its last state every poll.
	lastProgress := ""
	hostVersions := map[int64]string{}
	changeVersions := map[int64]string{}
	for {
		poll, release := context.WithTimeout(ctx, 5*time.Second)
		currentUser, currentPassword, authErr := s.streamUser(poll, auth.Token, role)
		if authErr != nil {
			release()
			streamClose(conn, streamAuthCode(authErr))
			return
		}
		if currentUser.ID != user.ID || currentPassword != passwordVersion {
			release()
			streamClose(conn, 1008)
			return
		}
		if collection == "assets" {
			var hosts []map[string]any
			hosts, err = s.streamHosts(poll)
			if err == nil {
				err = streamSend(conn, map[string]any{"type": "hosts", "hosts": hosts})
			}
		} else {
			var doc map[string]any
			doc, err = s.streamDocument(poll, collection, id)
			if err == nil {
				if initial {
					if collection == "scans" {
						err = streamSend(conn, map[string]any{"type": "snapshot", "scan": map[string]any{"id": id, "status": doc["status"], "done": doc["done_checks"], "total": doc["total_checks"]}, "hosts": doc["hosts"]})
					} else {
						err = streamSend(conn, map[string]any{"type": "snapshot", "run": doc})
					}
				}
				if err == nil && collection == "scans" {
					for _, host := range featureMaps(doc["hosts"]) {
						hostID := integer(host["id"])
						raw, marshalErr := json.Marshal(host)
						if marshalErr != nil {
							err = marshalErr
							break
						}
						if hostVersions[hostID] != string(raw) {
							err = streamSend(conn, map[string]any{"type": "host", "host_id": hostID, "host": host, "status": host["status"]})
							if err != nil {
								break
							}
							hostVersions[hostID] = string(raw)
						}
					}
					results := featureMaps(doc["results"])
					if initial && len(results) > 300 {
						cursor = len(results) - 300
					}
					if cursor > len(results) {
						cursor = 0
					}
					end := min(cursor+500, len(results))
					for err == nil && cursor < end {
						check := results[cursor]
						err = streamSend(conn, map[string]any{"type": "check", "host_id": check["host_result_id"], "asset_name": check["asset_name"], "control_id": check["control_id"], "title": check["title"], "status": check["status"], "actual": check["actual"], "expected": check["expected"], "duration_ms": check["duration_ms"], "done": doc["done_checks"]})
						if err == nil {
							cursor++
						}
					}
					progress := fmt.Sprint(doc["status"], "|", doc["done_checks"], "|", doc["total_checks"])
					if err == nil && progress != lastProgress {
						err = streamSend(conn, map[string]any{"type": "scan", "status": doc["status"], "done": doc["done_checks"], "total": doc["total_checks"]})
						if err == nil {
							lastProgress = progress
						}
					}
				} else if err == nil {
					// One line per change of a single control, then progress, then the run state.
					for _, change := range featureMaps(doc["changes"]) {
						cid := integer(change["id"])
						state := text(change["status"])
						rollback := text(change["rollback_status"])
						version := state + "|" + rollback
						previous, seen := changeVersions[cid]
						changeVersions[cid] = version
						if initial || (seen && previous == version) || state == "pending" {
							continue
						}
						if !seen || strings.SplitN(previous, "|", 2)[0] != state {
							err = streamSend(conn, map[string]any{"type": "item", "asset_name": change["asset_name"], "control_id": change["control_id"], "status": state, "message": change["message"]})
						}
						if err == nil && rollback != "" && (!seen || !strings.HasSuffix(previous, "|"+rollback)) {
							err = streamSend(conn, map[string]any{"type": "rollback", "asset_name": change["asset_name"], "control_id": change["control_id"], "status": rollback})
						}
						if err != nil {
							break
						}
					}
					progress := fmt.Sprint(doc["done_changes"], "|", doc["total_changes"])
					if err == nil && progress != lastProgress {
						err = streamSend(conn, map[string]any{"type": "change", "done": doc["done_changes"], "total": doc["total_changes"]})
						if err == nil {
							lastProgress = progress
						}
					}
					status := text(doc["status"])
					if err == nil && status != lastStatus {
						err = streamSend(conn, map[string]any{"type": "run", "status": status})
						lastStatus = status
					}
				}
			}
		}
		release()
		if err != nil {
			if ctx.Err() == nil {
				message := "Live stream is unavailable"
				if errors.Is(err, sql.ErrNoRows) {
					message = "Stream record not found"
				}
				if sendErr := streamSend(conn, map[string]string{"type": "error", "message": message}); sendErr != nil {
					slog.Debug("websocket error delivery failed")
				}
				slog.Warn("websocket data polling failed", "collection", collection)
			}
			return
		}
		initial = false
		select {
		case <-ctx.Done():
			streamClose(conn, 1000)
			return
		case <-ticker.C:
		}
	}
}
