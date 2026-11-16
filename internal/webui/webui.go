// Package webui embeds the built React dashboard so a core release is one self-contained binary.
// The release build copies frontend/dist into site/ before compiling. A development build that has
// no bundle simply serves no web pages (the API still works and nginx or Vite serve the UI).
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:site
var embedded embed.FS

// Handler serves the dashboard with single page app routing, or returns nil when no bundle is embedded.
func Handler() http.Handler {
	site, err := fs.Sub(embedded, "site")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(site, "index.html"); err != nil {
		return nil
	}
	files := http.FileServerFS(site)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Unknown API paths must stay API errors, not the dashboard page.
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") || strings.HasPrefix(r.URL.Path, "/downloads/") {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if info, err := fs.Stat(site, name); err == nil && !info.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				// Vite names these files by content hash, so they can be cached for good.
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else if name == "index.html" {
				w.Header().Set("Cache-Control", "no-cache")
			}
			files.ServeHTTP(w, r)
			return
		}
		// A path with a file extension that does not exist is a real 404; anything else is a client side route.
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		files.ServeHTTP(w, r2)
	})
}
