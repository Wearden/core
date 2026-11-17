package app

import (
	"context"
	"database/sql"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

// Role based access control. A role has a level (the coarse viewer, operator or
// admin rank used by the existing route guards) and a set of named permissions
// that gate the administrative features. The built in admin role holds every
// permission; viewer and operator hold none. Custom roles are stored as documents
// and can add permissions on top of a viewer or operator level.
type permissionDef struct {
	ID    string `json:"id"`
	Group string `json:"group"`
	Label string `json:"label"`
}

var permissionCatalog = []permissionDef{
	{"users.manage", "Access", "Create, edit, deactivate and delete users"},
	{"roles.manage", "Access", "Create, edit and delete roles"},
	{"settings.manage", "Platform", "Change platform settings and stored secrets"},
	{"ai.manage", "Platform", "Add, edit and test AI providers"},
	{"agents.enroll", "Fleet", "Create enrollment tokens and revoke agents"},
	{"assets.delete", "Fleet", "Delete assets"},
	{"credentials.manage", "Fleet", "Set or remove stored host credentials"},
	{"vault.manage", "PAM", "Add, edit and delete password vault entries"},
	{"jit.approve", "PAM", "Approve, deny and revoke just-in-time access and set the zero standing privileges policy"},
}

var roleNameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,31}$`)

const rolesCollection = "roles"

var levelRank = map[string]int{"viewer": 1, "operator": 2, "admin": 3}

func allPermissionIDs() []string {
	out := make([]string, 0, len(permissionCatalog))
	for _, p := range permissionCatalog {
		out = append(out, p.ID)
	}
	return out
}

func validPermission(id string) bool {
	for _, p := range permissionCatalog {
		if p.ID == id {
			return true
		}
	}
	return false
}

func isBuiltinRole(name string) bool { return name == "viewer" || name == "operator" || name == "admin" }

func hasAll(have []string, want []string) bool {
	set := map[string]bool{}
	for _, h := range have {
		set[h] = true
	}
	for _, w := range want {
		if !set[w] {
			return false
		}
	}
	return true
}

func hasPerm(u User, perm string) bool {
	for _, p := range u.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

// roleInfo resolves a role name to its level and permissions.
func (s *Server) roleInfo(ctx context.Context, name string) (level string, perms []string, ok bool) {
	switch name {
	case "admin":
		return "admin", allPermissionIDs(), true
	case "operator":
		return "operator", []string{}, true
	case "viewer":
		return "viewer", []string{}, true
	}
	doc, err := s.Store.Get(ctx, rolesCollection, name)
	if err != nil {
		return "viewer", []string{}, false
	}
	level = text(doc["level"])
	if level != "viewer" && level != "operator" {
		level = "viewer"
	}
	perms = []string{}
	for _, p := range array(doc["permissions"]) {
		if id, _ := p.(string); validPermission(id) {
			perms = append(perms, id)
		}
	}
	return level, perms, true
}

// canGrant reports whether the actor may hand out or manage a role: the actor must
// already hold its level and every permission it carries (no privilege escalation).
func (s *Server) canGrant(ctx context.Context, actor User, role string) bool {
	level, perms, ok := s.roleInfo(ctx, role)
	if !ok {
		return false
	}
	return levelRank[level] <= levelRank[actor.Level] && hasAll(actor.Permissions, perms)
}

func (s *Server) gate(check func(User) bool, denied string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := s.user(r.Context(), bearer(r))
		if err != nil {
			problem(w, 401, "Not authenticated")
			return
		}
		if !check(u) {
			problem(w, 403, denied)
			return
		}
		if u.MustChange && r.URL.Path != "/api/auth/me" && r.URL.Path != "/api/auth/change-password" && r.URL.Path != "/api/auth/logout" {
			problem(w, 403, "Change the initial password first")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	}
}

func (s *Server) requirePerm(perm string, h http.HandlerFunc) http.HandlerFunc {
	return s.gate(func(u User) bool { return hasPerm(u, perm) }, "Missing permission: "+perm, h)
}

func cleanPermissions(in []string) ([]string, bool) {
	seen := map[string]bool{}
	out := []string{}
	for _, p := range in {
		if !validPermission(p) {
			return nil, false
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out, true
}

func (s *Server) roleRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/roles", s.requirePerm("users.manage", func(w http.ResponseWriter, r *http.Request) {
		counts := map[string]int{}
		rows, err := s.DB.QueryContext(r.Context(), "SELECT role,count(*) FROM users GROUP BY role")
		if err != nil {
			s.databaseError(w, err)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			var n int
			if rows.Scan(&name, &n) == nil {
				counts[name] = n
			}
		}
		out := []map[string]any{
			{"name": "admin", "description": "Full access to every feature, including users, roles and settings.", "level": "admin", "permissions": allPermissionIDs(), "builtin": true, "users": counts["admin"]},
			{"name": "operator", "description": "Runs scans and hardening, can roll changes back. No administration.", "level": "operator", "permissions": []string{}, "builtin": true, "users": counts["operator"]},
			{"name": "viewer", "description": "Read-only access to dashboards, scans and reports.", "level": "viewer", "permissions": []string{}, "builtin": true, "users": counts["viewer"]},
		}
		docs, err := s.Store.List(r.Context(), rolesCollection)
		if err != nil {
			s.databaseError(w, err)
			return
		}
		custom := []map[string]any{}
		for _, d := range docs {
			name := text(d["name"])
			if name == "" {
				continue
			}
			_, perms, _ := s.roleInfo(r.Context(), name)
			custom = append(custom, map[string]any{"name": name, "description": text(d["description"]), "level": text(d["level"]), "permissions": perms, "builtin": false, "users": counts[name]})
		}
		sort.Slice(custom, func(i, j int) bool { return custom[i]["name"].(string) < custom[j]["name"].(string) })
		writeJSON(w, 200, map[string]any{"roles": append(out, custom...), "permissions": permissionCatalog})
	}))
	save := func(create bool) http.HandlerFunc {
		return s.requirePerm("roles.manage", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Name        string   `json:"name"`
				Description string   `json:"description"`
				Level       string   `json:"level"`
				Permissions []string `json:"permissions"`
			}
			if !decode(w, r, &in) {
				return
			}
			name := in.Name
			if !create {
				name = r.PathValue("name")
			}
			if !roleNameRE.MatchString(name) || isBuiltinRole(name) {
				problem(w, 400, "Role name must be 2 to 32 characters (lowercase letters, digits, dash, underscore) and not a built in role")
				return
			}
			if in.Level != "viewer" && in.Level != "operator" {
				problem(w, 400, "A custom role has the viewer or operator level; administrator is built in")
				return
			}
			if len(in.Description) > 200 {
				problem(w, 400, "Description is too long")
				return
			}
			perms, ok := cleanPermissions(in.Permissions)
			if !ok {
				problem(w, 400, "Unknown permission")
				return
			}
			actor := current(r)
			if levelRank[in.Level] > levelRank[actor.Level] || !hasAll(actor.Permissions, perms) {
				problem(w, 403, "You cannot grant access you do not hold yourself")
				return
			}
			_, err := s.Store.Get(r.Context(), rolesCollection, name)
			exists := err == nil
			if create && exists {
				problem(w, 409, "A role with this name already exists")
				return
			}
			if !create && !exists {
				problem(w, 404, "Role not found")
				return
			}
			doc := map[string]any{"name": name, "description": strings.TrimSpace(in.Description), "level": in.Level, "permissions": perms, "updated_by": actor.Username, "updated_at": now()}
			if err := s.Store.Put(r.Context(), rolesCollection, name, doc); err != nil {
				s.databaseError(w, err)
				return
			}
			action := "role.updated"
			if create {
				action = "role.created"
			}
			s.audit(r, action, name, true, in.Level)
			writeJSON(w, 200, doc)
		})
	}
	mux.HandleFunc("POST /api/roles", save(true))
	mux.HandleFunc("PUT /api/roles/{name}", save(false))
	mux.HandleFunc("DELETE /api/roles/{name}", s.requirePerm("roles.manage", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if isBuiltinRole(name) {
			problem(w, 409, "Built in roles cannot be deleted")
			return
		}
		if _, err := s.Store.Get(r.Context(), rolesCollection, name); err != nil {
			problem(w, 404, "Role not found")
			return
		}
		var n int
		if err := s.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM users WHERE role=$1", name).Scan(&n); err != nil {
			s.databaseError(w, err)
			return
		}
		if n > 0 {
			problem(w, 409, "Reassign the users who still have this role first")
			return
		}
		if _, err := s.DB.ExecContext(r.Context(), "DELETE FROM documents WHERE collection=$1 AND id=$2", rolesCollection, name); err != nil {
			s.databaseError(w, err)
			return
		}
		s.audit(r, "role.deleted", name, true, "")
		w.WriteHeader(204)
	}))
}

var _ = sql.ErrNoRows
