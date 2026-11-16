package app

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Agent self-install: core serves a short installer script and the agent binary
// with its checksum list, so a workstation only needs one command and a token.
// Nothing here is secret; enrollment still requires the admin-issued token.
const installScript = `#!/bin/sh
# Wearden agent installer for Linux amd64. Served by the core named below.
set -eu
CORE_URL="__CORE_URL__"
BIN="wearden-agent-linux-amd64"
TOKEN=""
REMEDIATION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --token) [ $# -ge 2 ] || { echo "--token needs a value" >&2; exit 2; }; TOKEN="$2"; shift 2 ;;
    --allow-remediation) REMEDIATION="-allow-remediation"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TOKEN" ] || { echo "usage: install-agent.sh --token <enrollment token> [--allow-remediation]" >&2; exit 2; }
case "$TOKEN" in *[!A-Za-z0-9._-]*) echo "token has unexpected characters" >&2; exit 2 ;; esac
[ "$(id -u)" -eq 0 ] || { echo "run as root, for example: ... | sudo sh -s -- --token <token>" >&2; exit 1; }
[ "$(uname -m)" = "x86_64" ] || { echo "only x86_64 is supported" >&2; exit 1; }
for tool in curl sha256sum systemctl install; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing required tool: $tool" >&2; exit 1; }
done
case "$CORE_URL" in
  https://*|http://127.0.0.1*|http://localhost*) ;;
  *) echo "warning: the agent refuses plain http for non-loopback cores; serve core over https" >&2 ;;
esac
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$CORE_URL/downloads/$BIN" -o "$tmp/agent"
curl -fsSL "$CORE_URL/downloads/SHA256SUMS" -o "$tmp/SHA256SUMS"
expected="$(grep " $BIN\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
actual="$(sha256sum "$tmp/agent" | cut -d' ' -f1)"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "checksum mismatch, nothing was installed" >&2; exit 1; }
install -o root -g root -m 0755 "$tmp/agent" /usr/local/sbin/wearden-agent
install -d -m 0700 /var/lib/wearden-agent /etc/wearden
( umask 077; printf 'WEARDEN_ENROLLMENT_TOKEN=%s\n' "$TOKEN" > /etc/wearden/agent.env )
cat > /etc/systemd/system/wearden-agent.service <<UNIT
[Unit]
Description=Wearden agent
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/wearden/agent.env
ExecStart=/usr/local/sbin/wearden-agent -daemon -core-url $CORE_URL $REMEDIATION -state-dir /var/lib/wearden-agent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now wearden-agent
echo "Wearden agent installed. It enrolls itself with $CORE_URL and appears under Assets."
`

var downloadName = regexp.MustCompile(`^(wearden-agent-linux-amd64|wearden-agent-windows-amd64\.exe|SHA256SUMS)$`)

// downloadAvailable reports whether a published agent file can be served.
func (s *Server) downloadAvailable(name string) bool {
	if s.Config.DownloadsDir == "" || !downloadName.MatchString(name) {
		return false
	}
	info, err := os.Stat(filepath.Join(s.Config.DownloadsDir, name))
	return err == nil && info.Mode().IsRegular()
}

var originHost = regexp.MustCompile(`^[A-Za-z0-9.-]+(:\d{1,5})?$`)

// publicURL prefers the configured origin; otherwise it uses the request host
// after validating its shape, so a hostile Host header cannot inject script text.
func (s *Server) publicURL(r *http.Request) string {
	if s.Config.AllowedOrigin != "" {
		return strings.TrimRight(s.Config.AllowedOrigin, "/")
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	if originHost.MatchString(r.Host) {
		return scheme + "://" + r.Host
	}
	return ""
}

func (s *Server) installRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /install-agent.sh", func(w http.ResponseWriter, r *http.Request) {
		base := s.publicURL(r)
		if base == "" || strings.ContainsAny(base, "\"\\$`\n\r ") {
			problem(w, 400, "Cannot determine a safe core address; set PUBLIC_ORIGIN")
			return
		}
		w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(strings.Replace(installScript, "__CORE_URL__", base, 1)))
	})
	mux.HandleFunc("GET /downloads/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if s.Config.DownloadsDir == "" || !downloadName.MatchString(name) {
			http.NotFound(w, r)
			return
		}
		path := filepath.Join(s.Config.DownloadsDir, name)
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		http.ServeFile(w, r, path)
	})
	mux.HandleFunc("GET /api/agents/install-info", s.require("viewer", func(w http.ResponseWriter, r *http.Request) {
		sums := s.downloadAvailable("SHA256SUMS")
		writeJSON(w, 200, map[string]any{
			"linux_available":   s.downloadAvailable(linuxAgentBinary),
			"windows_available": s.downloadAvailable(windowsAgentBinary),
			// Remote installation also needs the checksum list and an HTTPS origin the host can reach.
			"remote_install_ready": sums && strings.HasPrefix(s.publicURL(r), "https://"),
		})
	}))
}
