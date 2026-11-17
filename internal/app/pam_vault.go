package app

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Wearden/core/internal/security"
)

// Password vault and just-in-time (JIT) access for PAM.
//
// Vault entries hold a sealed secret (AES-GCM with WEARDEN_VAULT_KEY) that the API never lists.
// A secret is shown only to the one user who has the entry checked out, until the check-out ends.
// Password and SSH key entries linked to an asset can also open a recorded remote session with the
// secret injected, so the operator never sees it.
//
// JIT grants give one user access to one asset or vault entry for a limited time once an approver
// accepts the request. With the zero standing privileges policy on, remote sessions, credential
// injection and vault check-outs all need an active grant; when the grant ends or is revoked,
// live sessions are cut by the bridge's periodic check and check-outs stop revealing the secret.

const (
	vaultCollection = "pam_vault"
	jitCollection   = "pam_jit"
	jitPolicyID     = "policy"
	jitPolicyColl   = "pam_policy"
	jitMinMinutes   = 5
	jitMaxMinutes   = 8 * 60
)

var vaultTypes = map[string]bool{"password": true, "ssh_key": true, "certificate": true, "api_key": true}

func (s *Server) pamVaultRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/pam/vault", s.require("operator", s.vaultList))
	mux.HandleFunc("POST /api/pam/vault", s.requirePerm("vault.manage", s.vaultSave))
	mux.HandleFunc("PUT /api/pam/vault/{id}", s.requirePerm("vault.manage", s.vaultSave))
	mux.HandleFunc("DELETE /api/pam/vault/{id}", s.requirePerm("vault.manage", s.vaultDelete))
	mux.HandleFunc("POST /api/pam/vault/{id}/checkout", s.require("operator", s.vaultCheckout))
	mux.HandleFunc("POST /api/pam/vault/{id}/checkin", s.require("operator", s.vaultCheckin))
	mux.HandleFunc("GET /api/pam/vault/{id}/secret", s.require("operator", s.vaultSecret))
	mux.HandleFunc("GET /api/pam/jit", s.require("operator", s.jitList))
	mux.HandleFunc("POST /api/pam/jit", s.require("operator", s.jitRequest))
	mux.HandleFunc("POST /api/pam/jit/{id}/approve", s.requirePerm("jit.approve", s.jitDecide("approved")))
	mux.HandleFunc("POST /api/pam/jit/{id}/deny", s.requirePerm("jit.approve", s.jitDecide("denied")))
	mux.HandleFunc("POST /api/pam/jit/{id}/revoke", s.require("operator", s.jitRevoke))
	mux.HandleFunc("PUT /api/pam/jit/policy", s.requirePerm("jit.approve", s.jitSetPolicy))
}

func nowUTC() time.Time { return time.Now().UTC() }

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

// until reports whether the RFC3339 value v lies in the future.
func until(v any) bool {
	t, err := time.Parse(time.RFC3339Nano, text(v))
	return err == nil && nowUTC().Before(t)
}

// earlier returns the earlier of two RFC3339 values; an empty or invalid b leaves a unchanged.
func earlier(a time.Time, b any) time.Time {
	if t, err := time.Parse(time.RFC3339Nano, text(b)); err == nil && t.Before(a) {
		return t
	}
	return a
}

func clampMinutes(m int) int { return max(jitMinMinutes, min(jitMaxMinutes, m)) }

// lockDoc reads one document for update inside tx, so concurrent check-outs and decisions serialize.
func lockDoc(ctx context.Context, tx *sql.Tx, collection, id string) (map[string]any, error) {
	var raw []byte
	if err := tx.QueryRowContext(ctx, "SELECT data FROM documents WHERE collection=$1 AND id=$2 FOR UPDATE", collection, id).Scan(&raw); err != nil {
		return nil, err
	}
	var doc map[string]any
	return doc, json.Unmarshal(raw, &doc)
}

func putDoc(ctx context.Context, tx *sql.Tx, collection, id string, doc map[string]any) error {
	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "UPDATE documents SET data=$3 WHERE collection=$1 AND id=$2", collection, id, data)
	return err
}

func (s *Server) assetName(ctx context.Context, id int64) (string, bool) {
	var raw []byte
	if s.DB.QueryRowContext(ctx, "SELECT data FROM assets WHERE id=$1", id).Scan(&raw) != nil {
		return "", false
	}
	var a map[string]any
	if json.Unmarshal(raw, &a) != nil {
		return "", false
	}
	return text(a["name"]), true
}

// ---------- vault ----------

// vaultOut is the listed form of an entry: never the secret, plus whether it is checked out right now.
func vaultOut(doc map[string]any, me User) map[string]any {
	out := map[string]any{}
	for _, k := range []string{"id", "name", "type", "username", "asset_id", "asset_name", "notes", "created_by", "created_at", "updated_at"} {
		out[k] = doc[k]
	}
	held := text(doc["checked_out_by"]) != "" && until(doc["checkout_expires_at"])
	out["checked_out"] = held
	if held {
		out["checked_out_by"] = doc["checked_out_by"]
		out["checkout_expires_at"] = doc["checkout_expires_at"]
		out["checkout_reason"] = doc["checkout_reason"]
		out["mine"] = integer(doc["checked_out_by_id"]) == me.ID
	}
	return out
}

func (s *Server) vaultList(w http.ResponseWriter, r *http.Request) {
	docs, err := s.Store.List(r.Context(), vaultCollection)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	out := []map[string]any{}
	for _, d := range docs {
		out = append(out, vaultOut(d, current(r)))
	}
	writeJSON(w, 200, out)
}

func (s *Server) vaultSave(w http.ResponseWriter, r *http.Request) {
	if s.Config.VaultKey == "" {
		problem(w, 503, "Vault key is not configured (WEARDEN_VAULT_KEY)")
		return
	}
	var in struct {
		Name     string `json:"name"`
		Type     string `json:"type"`
		Username string `json:"username"`
		AssetID  int64  `json:"asset_id"`
		Secret   string `json:"secret"`
		Notes    string `json:"notes"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name, in.Username, in.Notes = strings.TrimSpace(in.Name), strings.TrimSpace(in.Username), strings.TrimSpace(in.Notes)
	id := r.PathValue("id")
	creating := id == ""
	if in.Name == "" || len(in.Name) > 120 || !vaultTypes[in.Type] || len(in.Username) > 255 || len(in.Notes) > 2000 || len(in.Secret) > 64*1024 || (creating && in.Secret == "") {
		problem(w, 400, "Name (up to 120 characters), a valid type and a secret are required")
		return
	}
	if in.AssetID != 0 && in.Type != "password" && in.Type != "ssh_key" {
		problem(w, 400, "Only password and SSH key entries can be linked to an asset")
		return
	}
	doc := map[string]any{}
	if creating {
		var err error
		if id, err = security.ID(); err != nil {
			problem(w, 500, "Cannot create entry identifier")
			return
		}
		doc = map[string]any{"id": id, "created_by": current(r).Username, "created_at": now()}
	} else {
		existing, err := s.Store.Get(r.Context(), vaultCollection, id)
		if err != nil {
			problem(w, 404, "Vault entry not found")
			return
		}
		doc = existing
	}
	assetName := ""
	if in.AssetID != 0 {
		name, ok := s.assetName(r.Context(), in.AssetID)
		if !ok {
			problem(w, 400, "Linked asset not found")
			return
		}
		assetName = name
	}
	if in.Secret != "" {
		sealed, err := security.Seal(s.Config.VaultKey, []byte(in.Secret))
		if err != nil {
			problem(w, 500, "Cannot encrypt secret")
			return
		}
		doc["sealed"] = base64.StdEncoding.EncodeToString(sealed)
	}
	doc["name"], doc["type"], doc["username"], doc["notes"], doc["updated_at"] = in.Name, in.Type, in.Username, in.Notes, now()
	doc["asset_id"], doc["asset_name"] = nil, nil
	if in.AssetID != 0 {
		doc["asset_id"], doc["asset_name"] = in.AssetID, assetName
	}
	if err := s.Store.Put(r.Context(), vaultCollection, id, doc); err != nil {
		s.databaseError(w, err)
		return
	}
	action := "vault.update"
	if creating {
		action = "vault.create"
	}
	s.audit(r, action, id, true, in.Name)
	writeJSON(w, 200, vaultOut(doc, current(r)))
}

func (s *Server) vaultDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	res, err := s.DB.ExecContext(r.Context(), "DELETE FROM documents WHERE collection=$1 AND id=$2", vaultCollection, id)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		problem(w, 404, "Vault entry not found")
		return
	}
	s.audit(r, "vault.delete", id, true, "")
	w.WriteHeader(204)
}

func (s *Server) vaultCheckout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Minutes int    `json:"minutes"`
		Reason  string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Reason == "" || len(in.Reason) > 500 {
		problem(w, 400, "A reason is required for a check-out")
		return
	}
	id, me := r.PathValue("id"), current(r)
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	doc, err := lockDoc(r.Context(), tx, vaultCollection, id)
	if err != nil {
		problem(w, 404, "Vault entry not found")
		return
	}
	if text(doc["checked_out_by"]) != "" && until(doc["checkout_expires_at"]) && integer(doc["checked_out_by_id"]) != me.ID {
		problem(w, 409, "Checked out by "+text(doc["checked_out_by"])+" until they check it in or the check-out expires")
		return
	}
	expires := nowUTC().Add(time.Duration(clampMinutes(in.Minutes)) * time.Minute)
	grant, ok := s.jitAllowed(r.Context(), me, integer(doc["asset_id"]), id)
	if !ok {
		problem(w, 403, "Just-in-time access is required: request access to this entry or its asset first")
		return
	}
	if grant != nil {
		expires = earlier(expires, grant["expires_at"])
		doc["checkout_grant_id"] = grant["id"]
	} else {
		doc["checkout_grant_id"] = nil
	}
	doc["checked_out_by"], doc["checked_out_by_id"], doc["checkout_reason"] = me.Username, me.ID, in.Reason
	doc["checked_out_at"], doc["checkout_expires_at"] = now(), stamp(expires)
	if err := putDoc(r.Context(), tx, vaultCollection, id, doc); err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "vault.checkout", id, true, in.Reason)
	writeJSON(w, 200, vaultOut(doc, me))
}

func (s *Server) vaultCheckin(w http.ResponseWriter, r *http.Request) {
	id, me := r.PathValue("id"), current(r)
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	doc, err := lockDoc(r.Context(), tx, vaultCollection, id)
	if err != nil {
		problem(w, 404, "Vault entry not found")
		return
	}
	if integer(doc["checked_out_by_id"]) != me.ID && !hasPerm(me, "vault.manage") {
		problem(w, 403, "Only the holder or a vault manager can check this entry in")
		return
	}
	for _, k := range []string{"checked_out_by", "checked_out_by_id", "checkout_reason", "checked_out_at", "checkout_expires_at", "checkout_grant_id"} {
		delete(doc, k)
	}
	if err := putDoc(r.Context(), tx, vaultCollection, id, doc); err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "vault.checkin", id, true, "")
	writeJSON(w, 200, vaultOut(doc, me))
}

func (s *Server) vaultSecret(w http.ResponseWriter, r *http.Request) {
	id, me := r.PathValue("id"), current(r)
	doc, err := s.Store.Get(r.Context(), vaultCollection, id)
	if err != nil {
		problem(w, 404, "Vault entry not found")
		return
	}
	if integer(doc["checked_out_by_id"]) != me.ID || !until(doc["checkout_expires_at"]) {
		problem(w, 403, "Check the entry out first; the secret is shown only during your check-out")
		return
	}
	if g := text(doc["checkout_grant_id"]); g != "" && !s.jitGrantActive(r.Context(), g) {
		problem(w, 403, "The just-in-time grant for this check-out has ended")
		return
	}
	secret, err := s.vaultOpen(doc)
	if err != nil {
		problem(w, 503, "Cannot decrypt the secret")
		return
	}
	s.audit(r, "vault.reveal", id, true, "")
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"secret": string(secret), "expires_at": doc["checkout_expires_at"]})
}

func (s *Server) vaultOpen(doc map[string]any) ([]byte, error) {
	sealed, err := base64.StdEncoding.DecodeString(text(doc["sealed"]))
	if err != nil {
		return nil, err
	}
	return security.Open(s.Config.VaultKey, sealed)
}

// vaultCredential supplies a remote session with the username, auth type and sealed secret of a
// vault entry instead of the asset's own stored credential. The entry must be linked to that asset.
func (s *Server) vaultCredential(ctx context.Context, vaultID string, assetID int64) (username, authType string, sealed []byte, err error) {
	doc, err := s.Store.Get(ctx, vaultCollection, vaultID)
	if err != nil {
		return "", "", nil, errors.New("Vault entry not found")
	}
	if integer(doc["asset_id"]) != assetID || (text(doc["type"]) != "password" && text(doc["type"]) != "ssh_key") {
		return "", "", nil, errors.New("This vault entry is not a password or SSH key linked to the asset")
	}
	sealed, err = base64.StdEncoding.DecodeString(text(doc["sealed"]))
	if err != nil {
		return "", "", nil, errors.New("Stored vault secret is damaged")
	}
	return text(doc["username"]), text(doc["type"]), sealed, nil
}

// ---------- just-in-time access ----------

func (s *Server) jitRequired(ctx context.Context) bool {
	doc, err := s.Store.Get(ctx, jitPolicyColl, jitPolicyID)
	return err == nil && doc["required"] == true
}

func jitActive(g map[string]any) bool {
	return text(g["status"]) == "approved" && until(g["expires_at"])
}

func (s *Server) jitGrantActive(ctx context.Context, id string) bool {
	g, err := s.Store.Get(ctx, jitCollection, id)
	return err == nil && jitActive(g)
}

// jitAllowed reports whether u may use the asset or vault entry now. Without the zero standing
// privileges policy everything is allowed and no grant is returned. With it, an active grant of u
// for the asset or the entry is required; the one ending last is returned.
func (s *Server) jitAllowed(ctx context.Context, u User, assetID int64, vaultID string) (map[string]any, bool) {
	if !s.jitRequired(ctx) {
		return nil, true
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT data FROM documents WHERE collection=$1 AND data->>'user_id'=$2 AND data->>'status'='approved'", jitCollection, strconv.FormatInt(u.ID, 10))
	if err != nil {
		return nil, false
	}
	defer rows.Close()
	var best map[string]any
	for rows.Next() {
		var raw []byte
		var g map[string]any
		if rows.Scan(&raw) != nil || json.Unmarshal(raw, &g) != nil || !jitActive(g) {
			continue
		}
		match := (text(g["target_type"]) == "asset" && assetID != 0 && integer(g["target_id"]) == assetID) ||
			(text(g["target_type"]) == "vault" && vaultID != "" && text(g["target_id"]) == vaultID)
		if match && (best == nil || text(g["expires_at"]) > text(best["expires_at"])) {
			best = g
		}
	}
	return best, best != nil
}

func jitOut(g map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range g {
		out[k] = v
	}
	if text(g["status"]) == "approved" && !until(g["expires_at"]) {
		out["status"] = "expired"
	}
	return out
}

func (s *Server) jitList(w http.ResponseWriter, r *http.Request) {
	grants, err := s.Store.List(r.Context(), jitCollection)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	me := current(r)
	approver := hasPerm(me, "jit.approve")
	out := []map[string]any{}
	for _, g := range grants {
		if approver || integer(g["user_id"]) == me.ID {
			out = append(out, jitOut(g))
		}
	}
	writeJSON(w, 200, map[string]any{
		"policy":      map[string]any{"required": s.jitRequired(r.Context()), "min_minutes": jitMinMinutes, "max_minutes": jitMaxMinutes},
		"grants":      out,
		"can_approve": approver,
	})
}

func (s *Server) jitRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		Minutes    int    `json:"minutes"`
		Reason     string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Reason == "" || len(in.Reason) > 500 || in.Minutes < jitMinMinutes || in.Minutes > jitMaxMinutes {
		problem(w, 400, "A reason and a duration between 5 minutes and 8 hours are required")
		return
	}
	var target any
	name := ""
	switch in.TargetType {
	case "asset":
		aid, err := strconv.ParseInt(in.TargetID, 10, 64)
		n, ok := s.assetName(r.Context(), aid)
		if err != nil || !ok {
			problem(w, 400, "Asset not found")
			return
		}
		target, name = aid, n
	case "vault":
		doc, err := s.Store.Get(r.Context(), vaultCollection, in.TargetID)
		if err != nil {
			problem(w, 400, "Vault entry not found")
			return
		}
		target, name = in.TargetID, text(doc["name"])
	default:
		problem(w, 400, "Target must be an asset or a vault entry")
		return
	}
	id, err := security.ID()
	if err != nil {
		problem(w, 500, "Cannot create request identifier")
		return
	}
	me := current(r)
	g := map[string]any{"id": id, "user_id": me.ID, "username": me.Username, "target_type": in.TargetType, "target_id": target, "target_name": name,
		"minutes": in.Minutes, "reason": in.Reason, "status": "pending", "requested_at": now()}
	if err := s.Store.Put(r.Context(), jitCollection, id, g); err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "jit.request", id, true, in.TargetType+" "+name)
	writeJSON(w, 201, jitOut(g))
}

// jitDecide approves or denies a pending request. An approved grant starts now and lasts the requested minutes.
func (s *Server) jitDecide(status string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, me := r.PathValue("id"), current(r)
		tx, err := s.DB.BeginTx(r.Context(), nil)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer tx.Rollback()
		g, err := lockDoc(r.Context(), tx, jitCollection, id)
		if err != nil {
			problem(w, 404, "Request not found")
			return
		}
		if text(g["status"]) != "pending" {
			problem(w, 409, "This request was already decided")
			return
		}
		g["status"], g["decided_by"], g["decided_at"] = status, me.Username, now()
		g["self_approved"] = status == "approved" && integer(g["user_id"]) == me.ID
		if status == "approved" {
			start := nowUTC()
			g["starts_at"], g["expires_at"] = stamp(start), stamp(start.Add(time.Duration(clampMinutes(int(integer(g["minutes"]))))*time.Minute))
		}
		if err := putDoc(r.Context(), tx, jitCollection, id, g); err == nil {
			err = tx.Commit()
		}
		if err != nil {
			s.databaseError(w, err)
			return
		}
		detail := text(g["username"]) + " " + text(g["target_name"])
		if g["self_approved"] == true {
			detail += " (self-approved)"
		}
		s.audit(r, map[string]string{"approved": "jit.approve", "denied": "jit.deny"}[status], id, true, detail)
		writeJSON(w, 200, jitOut(g))
	}
}

// jitRevoke ends a grant early, or withdraws a pending request. The holder or an approver may do it.
func (s *Server) jitRevoke(w http.ResponseWriter, r *http.Request) {
	id, me := r.PathValue("id"), current(r)
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		s.databaseError(w, err)
		return
	}
	defer tx.Rollback()
	g, err := lockDoc(r.Context(), tx, jitCollection, id)
	if err != nil {
		problem(w, 404, "Grant not found")
		return
	}
	if integer(g["user_id"]) != me.ID && !hasPerm(me, "jit.approve") {
		problem(w, 403, "Only the holder or an approver can revoke this grant")
		return
	}
	if st := text(g["status"]); st != "pending" && !jitActive(g) {
		problem(w, 409, "This grant is no longer active")
		return
	}
	g["status"], g["revoked_by"], g["revoked_at"] = "revoked", me.Username, now()
	if err := putDoc(r.Context(), tx, jitCollection, id, g); err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "jit.revoke", id, true, text(g["username"])+" "+text(g["target_name"]))
	writeJSON(w, 200, jitOut(g))
}

func (s *Server) jitSetPolicy(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Required bool `json:"required"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.Store.Put(r.Context(), jitPolicyColl, jitPolicyID, map[string]any{"required": in.Required, "updated_by": current(r).Username, "updated_at": now()}); err != nil {
		s.databaseError(w, err)
		return
	}
	s.audit(r, "jit.policy", jitPolicyID, true, "required="+strconv.FormatBool(in.Required))
	writeJSON(w, 200, map[string]any{"required": in.Required, "min_minutes": jitMinMinutes, "max_minutes": jitMaxMinutes})
}
