#!/bin/sh
# Wearden core installer for Linux (x86_64) with Docker.
#
#   curl -fsSL https://raw.githubusercontent.com/Wearden/core/main/scripts/install.sh | sudo sh
#   curl -fsSL https://raw.githubusercontent.com/Wearden/core/main/scripts/install.sh | sudo sh -s -- --domain wearden.example.com
#
# It downloads the source, writes a .env with freshly generated secrets, builds the images,
# builds the Linux agent so workstations can install it with one command, and starts everything.
# Running it again upgrades in place: the .env, the database and the agent downloads are kept.
#
# Options:
#   --domain NAME      serve over HTTPS on NAME with an automatic certificate (ports 80 and 443 must be reachable)
#   --bind ADDR        address the web port listens on without --domain (default 127.0.0.1; use 0.0.0.0 for the LAN)
#   --port N           web port without --domain (default 8080)
#   --dir PATH         install directory (default /opt/wearden)
#   --ref REF          branch, tag or commit of the Wearden repositories (default main; pin a tag in production)
#   --install-docker   install Docker with its official convenience script when it is missing
#   --no-agent-build   do not build the Linux agent
#   --uninstall        stop and remove the containers (data volumes are kept)
#   --purge --yes      with --uninstall: also delete the data volumes and the install directory
set -eu

ORG="Wearden"
DIR="/opt/wearden"
REF="main"
DOMAIN=""
BIND="127.0.0.1"
PORT="8080"
INSTALL_DOCKER=0
BUILD_AGENT=1
UNINSTALL=0
PURGE=0
YES=0

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) [ $# -ge 2 ] || die "--domain needs a value"; DOMAIN="$2"; shift 2 ;;
    --bind) [ $# -ge 2 ] || die "--bind needs a value"; BIND="$2"; shift 2 ;;
    --port) [ $# -ge 2 ] || die "--port needs a value"; PORT="$2"; shift 2 ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
    --ref) [ $# -ge 2 ] || die "--ref needs a value"; REF="$2"; shift 2 ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
    --no-agent-build) BUILD_AGENT=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,22p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$DOMAIN" in *[!A-Za-z0-9.-]*) die "the domain has unexpected characters" ;; esac
case "$PORT" in ''|*[!0-9]*) die "the port must be a number" ;; esac
case "$BIND" in *[!0-9.:]*) die "the bind address must be an IP address" ;; esac
case "$REF" in ''|*[!A-Za-z0-9._/-]*) die "the ref has unexpected characters" ;; esac
case "$DIR" in /*) ;; *) die "the install directory must be an absolute path" ;; esac

[ "$(id -u)" -eq 0 ] || die "run as root, for example: curl -fsSL <url> | sudo sh"
[ "$(uname -s)" = "Linux" ] || die "Linux is required"
[ "$(uname -m)" = "x86_64" ] || die "only x86_64 is supported"
for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done

compose() { (cd "$DIR/core" && docker compose "$@"); }

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" -eq 1 ]; then
  [ -f "$DIR/core/docker-compose.yml" ] || die "no installation found in $DIR"
  if [ "$PURGE" -eq 1 ]; then
    [ "$YES" -eq 1 ] || die "--purge deletes the database and every stored secret; repeat with --yes to confirm"
    compose --profile tls --profile sessions down -v --remove-orphans
    rm -rf "$DIR"
    say "Wearden was removed, including its data."
  else
    compose --profile tls --profile sessions down --remove-orphans
    say "Wearden was stopped and its containers removed. Data volumes and $DIR are kept; run the installer again to start it."
  fi
  exit 0
fi

# ------------------------------------------------------------------- docker
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [ "$INSTALL_DOCKER" -eq 1 ]; then
    say "Installing Docker with the official script from get.docker.com ..."
    curl -fsSL https://get.docker.com | sh
    command -v systemctl >/dev/null 2>&1 && systemctl enable --now docker >/dev/null 2>&1 || true
  else
    die "Docker with the compose plugin is required. Install it (https://docs.docker.com/engine/install/) or run this installer again with --install-docker"
  fi
fi
docker info >/dev/null 2>&1 || die "the Docker daemon is not running"

# ------------------------------------------------------------------- source
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "Downloading Wearden ($REF) ..."
for repo in core proto ruleset agent-linux; do
  mkdir -p "$tmp/$repo"
  curl -fsSL "https://codeload.github.com/$ORG/$repo/tar.gz/$REF" | tar -xz --strip-components=1 -C "$tmp/$repo" \
    || die "could not download $ORG/$repo at $REF"
done

mkdir -p "$DIR"
# State that survives an upgrade.
keep="$tmp/keep"
mkdir -p "$keep"
[ -f "$DIR/core/.env" ] && cp -p "$DIR/core/.env" "$keep/.env"
[ -d "$DIR/core/downloads" ] && cp -pR "$DIR/core/downloads" "$keep/downloads"
for repo in core proto ruleset agent-linux; do
  rm -rf "$DIR/$repo"
  mv "$tmp/$repo" "$DIR/$repo"
done
[ -f "$keep/.env" ] && cp -p "$keep/.env" "$DIR/core/.env"
mkdir -p "$DIR/core/downloads"
[ -d "$keep/downloads" ] && cp -pR "$keep/downloads/." "$DIR/core/downloads/"

# --------------------------------------------------------------------- .env
rand_alnum() { head -c 512 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c "$1"; }
rand_b64() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }

host_ip() {
  ip=""
  command -v hostname >/dev/null 2>&1 && ip="$(hostname -I 2>/dev/null | cut -d' ' -f1 || true)"
  printf '%s' "${ip:-localhost}"
}

if [ ! -f "$DIR/core/.env" ]; then
  say "Generating secrets ..."
  if [ -n "$DOMAIN" ]; then
    origin="https://$DOMAIN"
  elif [ "$BIND" = "127.0.0.1" ]; then
    origin="http://localhost:$PORT"
  else
    origin="http://$(host_ip):$PORT"
  fi
  (
    umask 077
    {
      printf 'POSTGRES_USER=wearden\n'
      printf 'POSTGRES_DB=wearden\n'
      printf 'POSTGRES_PASSWORD=%s\n' "$(rand_alnum 32)"
      printf 'WEARDEN_VAULT_KEY=%s\n' "$(rand_b64)"
      printf 'GUAC_CONTROL_KEY=%s\n' "$(rand_alnum 32)"
      printf 'GUAC_CRYPT_KEY=%s\n' "$(rand_alnum 32)"
      printf 'PUBLIC_ORIGIN=%s\n' "$origin"
      printf 'AGENT_DOWNLOADS_HOST_DIR=./downloads\n'
      printf 'RULESET_PATH=../ruleset\n'
      printf 'WEARDEN_BIND=%s\n' "$BIND"
      printf 'WEARDEN_PORT=%s\n' "$PORT"
      printf 'WEARDEN_DOMAIN=%s\n' "$DOMAIN"
      if [ -n "$DOMAIN" ]; then printf 'COMPOSE_PROFILES=tls\n'; fi
    } > "$DIR/core/.env"
  )
  chmod 600 "$DIR/core/.env"
else
  say "Keeping the existing $DIR/core/.env (secrets are not regenerated on upgrade)."
fi
# Read only the values needed here; the file is never executed.
env_value() { sed -n "s/^$1=//p" "$DIR/core/.env" | head -n 1; }
PORT="$(env_value WEARDEN_PORT)"; PORT="${PORT:-8080}"
BIND="$(env_value WEARDEN_BIND)"; BIND="${BIND:-127.0.0.1}"
ORIGIN="$(env_value PUBLIC_ORIGIN)"; ORIGIN="${ORIGIN:-http://localhost:$PORT}"

# -------------------------------------------------------------------- agent
if [ "$BUILD_AGENT" -eq 1 ]; then
  say "Building the Linux agent (this can take a few minutes the first time) ..."
  docker run --rm -v "$DIR":/src -w /src golang:1.25-alpine sh -c '
    set -eu
    go work init ./proto ./agent-linux
    go work edit -replace=github.com/Wearden/proto@v0.0.0=./proto
    go work sync
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /src/core/downloads/wearden-agent-linux-amd64 ./agent-linux/cmd/agent
  ' || die "the agent build failed; re-run with --no-agent-build to install core without it"
  rm -f "$DIR/go.work" "$DIR/go.work.sum"
  (cd "$DIR/core/downloads" && sha256sum wearden-agent-linux-amd64 > SHA256SUMS)
fi

# ------------------------------------------------------------------- start
say "Building and starting the containers ..."
compose up -d --build --remove-orphans

say "Waiting for core to answer ..."
probe="$BIND"
[ "$probe" = "0.0.0.0" ] && probe="127.0.0.1"
i=0
until curl -fsS "http://$probe:$PORT/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 60 ] || { compose logs --tail 40 backend >&2 || true; die "core did not become healthy; see the log above"; }
  sleep 2
done

say ""
say "Wearden is running."
say "  Open:        $ORIGIN"
say "  First step:  register on that page. The first account becomes the one and only administrator;"
say "               everyone who registers later waits for the administrator's approval."
if [ "$BUILD_AGENT" -eq 1 ]; then
  say "  Agents:      in Wearden go to Assets, Agents, Enroll a new agent, and copy the one-line command."
  say "               It looks like: curl -fsSL $ORIGIN/install-agent.sh | sudo sh -s -- --token <token>"
fi
case "$ORIGIN" in
  https://*) ;;
  *) say "  Note:        agents refuse plain http for a core that is not on this machine. For real hosts run again with --domain." ;;
esac
say "  Upgrade:     run the same installer command again. Remove: add --uninstall (and --purge --yes to delete data)."
say "  Secrets:     $DIR/core/.env (keep it private and back it up; the vault key cannot be recovered)."
