#!/bin/sh
# Wearden core installer for Linux (x86_64), from the prebuilt release. No Docker and no compiler needed.
#
#   curl -fsSL https://github.com/Wearden/core/releases/latest/download/install-core.sh | sudo sh
#   curl -fsSL https://github.com/Wearden/core/releases/latest/download/install-core.sh | sudo sh -s -- --url https://wearden.example.com --listen 127.0.0.1:8000
#
# It installs the core binary (the dashboard is inside it) as a systemd service, sets up PostgreSQL
# on Debian and Ubuntu (or uses --database-url), writes /etc/wearden/core.env with generated secrets,
# and downloads the Linux and Windows agents so workstations can install them from this core.
# Running it again upgrades in place; the environment file, the database and the data are kept.
#
# Options:
#   --version TAG        release tag to install (default: the latest release)
#   --mirror URL         download from your own server instead of GitHub (layout: URL/core/..., URL/agent-linux/..., URL/agent-windows/...)
#   --url URL            public address of this core, for example https://wearden.example.com
#   --listen ADDR        address core listens on (default 127.0.0.1:8000; put a TLS reverse proxy in front)
#   --database-url URL   existing PostgreSQL, for example postgresql://user:pass@host:5432/wearden?sslmode=require
#   --dir PATH           program directory (default /opt/wearden)
#   --data-dir PATH      data directory (default /var/lib/wearden)
#   --no-agents          do not download the agent binaries
#   --uninstall          stop and remove the service and the program (the database and data are kept)
#   --purge --yes        with --uninstall: also delete the data, the environment file and the database
set -eu

ORG="Wearden"
VERSION=""
MIRROR=""
URL=""
LISTEN="127.0.0.1:8000"
DBURL=""
DIR="/opt/wearden"
DATA="/var/lib/wearden"
AGENTS=1
UNINSTALL=0
PURGE=0
YES=0
ENVFILE="/etc/wearden/core.env"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
    --mirror) [ $# -ge 2 ] || die "--mirror needs a value"; MIRROR="$2"; shift 2 ;;
    --url) [ $# -ge 2 ] || die "--url needs a value"; URL="$2"; shift 2 ;;
    --listen) [ $# -ge 2 ] || die "--listen needs a value"; LISTEN="$2"; shift 2 ;;
    --database-url) [ $# -ge 2 ] || die "--database-url needs a value"; DBURL="$2"; shift 2 ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
    --data-dir) [ $# -ge 2 ] || die "--data-dir needs a value"; DATA="$2"; shift 2 ;;
    --no-agents) AGENTS=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,25p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$VERSION" in *[!A-Za-z0-9._-]*) die "the version has unexpected characters" ;; esac
case "$LISTEN" in *[!][A-Za-z0-9.:-]*) die "the listen address has unexpected characters" ;; esac
case "$URL" in ''|https://*|http://*) ;; *) die "--url must start with http:// or https://" ;; esac
case "$URL$MIRROR" in *[\ \"\\\$\`]*) die "--url and --mirror may not contain spaces, quotes or shell characters" ;; esac
case "$MIRROR" in ""|https://*|http://*) ;; *) die "--mirror must start with http:// or https://" ;; esac
case "$DIR$DATA" in *[!A-Za-z0-9._/-]*) die "directories may only contain letters, digits and . _ / -" ;; esac

[ "$(id -u)" -eq 0 ] || die "run as root, for example: curl -fsSL <url> | sudo sh"
[ "$(uname -s)" = "Linux" ] || die "Linux is required"
[ "$(uname -m)" = "x86_64" ] || die "only x86_64 is supported"
for tool in curl tar sha256sum systemctl; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" -eq 1 ]; then
  systemctl disable --now wearden-core >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/wearden-core.service
  systemctl daemon-reload
  rm -rf "$DIR"
  if [ "$PURGE" -eq 1 ]; then
    [ "$YES" -eq 1 ] || die "--purge deletes the database and every stored secret; repeat with --yes to confirm"
    if command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
      su postgres -c "psql -qc 'DROP DATABASE IF EXISTS wearden'" -c "DROP ROLE IF EXISTS wearden" >/dev/null 2>&1 || true
    fi
    rm -rf "$DATA" /etc/wearden
    userdel wearden >/dev/null 2>&1 || true
    say "Wearden was removed, including its data."
  else
    say "Wearden was stopped and removed. The database, $DATA and $ENVFILE are kept; run the installer again to bring it back."
  fi
  exit 0
fi

asset_url() { # repo file
  if [ -n "$MIRROR" ]; then
    printf '%s/%s/%s' "${MIRROR%/}" "$1" "$2"
  elif [ -n "$VERSION" ]; then
    printf 'https://github.com/%s/%s/releases/download/%s/%s' "$ORG" "$1" "$VERSION" "$2"
  else
    printf 'https://github.com/%s/%s/releases/latest/download/%s' "$ORG" "$1" "$2"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Downloads repo/file into the temp directory and checks it against the release SHA256SUMS.
# Returns non-zero (and says why) instead of exiting, so callers can decide how serious a failure is.
try_fetch() { # repo file
  curl -fsSL "$(asset_url "$1" "$2")" -o "$tmp/$2" || { say "could not download $2 from $ORG/$1 (does a release exist yet?)" >&2; return 1; }
  curl -fsSL "$(asset_url "$1" SHA256SUMS)" -o "$tmp/$1.sums" || { say "could not download SHA256SUMS from $ORG/$1" >&2; return 1; }
  want="$(grep " \*\{0,1\}$2\$" "$tmp/$1.sums" | cut -d' ' -f1 | head -n 1)"
  have="$(sha256sum "$tmp/$2" | cut -d' ' -f1)"
  [ -n "$want" ] && [ "$want" = "$have" ] || { say "checksum mismatch for $2" >&2; return 1; }
}
fetch_verified() { try_fetch "$@" || die "download of $2 failed, nothing was installed"; }

# ---------------------------------------------------------------- core
say "Downloading the core release ..."
fetch_verified core wearden-core-linux-amd64.tar.gz
mkdir -p "$tmp/core"
tar -xzf "$tmp/wearden-core-linux-amd64.tar.gz" -C "$tmp/core"
[ -f "$tmp/core/wearden-core" ] || die "the archive does not contain wearden-core"

id wearden >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin wearden
mkdir -p "$DIR" "$DATA/recordings" "$DATA/downloads" /etc/wearden
systemctl stop wearden-core >/dev/null 2>&1 || true
rm -rf "$DIR/ruleset"
install -m 0755 "$tmp/core/wearden-core" "$DIR/wearden-core"
cp -R "$tmp/core/ruleset" "$DIR/ruleset"
cp "$tmp/core/LICENSE" "$tmp/core/THIRD_PARTY_NOTICES.md" "$DIR/" 2>/dev/null || true
chown -R root:root "$DIR"
chown -R wearden:wearden "$DATA"

# ---------------------------------------------------------------- database and environment
rand_alnum() { head -c 512 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c "$1"; }

if [ ! -f "$ENVFILE" ]; then
  if [ -z "$DBURL" ]; then
    command -v apt-get >/dev/null 2>&1 || die "no database given. Install PostgreSQL yourself and pass --database-url, or use Debian or Ubuntu so the installer can set it up"
    if ! command -v psql >/dev/null 2>&1; then
      say "Installing PostgreSQL ..."
      DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql >/dev/null
    fi
    systemctl enable --now postgresql >/dev/null 2>&1 || true
    sleep 3
    dbpass="$(rand_alnum 32)"
    su postgres -c 'psql -v ON_ERROR_STOP=1 -q' <<SQL || die "could not create the database role"
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wearden') THEN CREATE ROLE wearden LOGIN; END IF; END \$\$;
ALTER ROLE wearden PASSWORD '$dbpass';
SQL
    have_db="$(su postgres -c 'psql -tA' <<SQL
SELECT 1 FROM pg_database WHERE datname = 'wearden';
SQL
)"
    [ "$have_db" = "1" ] || su postgres -c 'createdb -O wearden wearden' || die "could not create the database"
    DBURL="postgresql://wearden:$dbpass@127.0.0.1:5432/wearden?sslmode=disable"
  fi
  case "$LISTEN" in
    127.0.0.1:*|localhost:*|\[::1\]:*) default_origin="http://localhost:${LISTEN##*:}" ;;
    *) default_origin="http://$(hostname -I 2>/dev/null | cut -d' ' -f1):${LISTEN##*:}" ;;
  esac
  (
    umask 077
    {
      printf 'DATABASE_URL=%s\n' "$DBURL"
      printf 'WEARDEN_VAULT_KEY=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
      printf 'RULESET_PATH=%s/ruleset\n' "$DIR"
      printf 'LISTEN_ADDR=%s\n' "$LISTEN"
      printf 'PUBLIC_ORIGIN=%s\n' "${URL:-$default_origin}"
      printf 'RECORDINGS_DIR=%s/recordings\n' "$DATA"
      printf 'AGENT_DOWNLOADS_DIR=%s/downloads\n' "$DATA"
    } > "$ENVFILE"
  )
  chmod 600 "$ENVFILE"
  say "Wrote $ENVFILE with generated secrets (keep it private and back it up; the vault key cannot be recovered)."
else
  say "Keeping the existing $ENVFILE (secrets are not regenerated on upgrade)."
fi
env_value() { sed -n "s/^$1=//p" "$ENVFILE" | head -n 1; }

# ---------------------------------------------------------------- agents
if [ "$AGENTS" -eq 1 ]; then
  say "Downloading the agents ..."
  : > "$tmp/agent.sums"
  for spec in "agent-linux wearden-agent-linux-amd64" "agent-windows wearden-agent-windows-amd64.exe"; do
    # shellcheck disable=SC2086
    set -- $spec
    if try_fetch "$1" "$2"; then
      install -o wearden -g wearden -m 0644 "$tmp/$2" "$DATA/downloads/$2"
      printf '%s  %s\n' "$(sha256sum "$tmp/$2" | cut -d' ' -f1)" "$2" >> "$tmp/agent.sums"
    fi
  done
  install -o wearden -g wearden -m 0644 "$tmp/agent.sums" "$DATA/downloads/SHA256SUMS"
fi

# ---------------------------------------------------------------- service
cat > /etc/systemd/system/wearden-core.service <<UNIT
[Unit]
Description=Wearden core
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=wearden
Group=wearden
EnvironmentFile=$ENVFILE
WorkingDirectory=$DIR
ExecStart=$DIR/wearden-core
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now wearden-core >/dev/null

say "Waiting for core to answer ..."
listen="$(env_value LISTEN_ADDR)"
probe="${listen%:*}"
[ "$probe" = "0.0.0.0" ] && probe="127.0.0.1"
port="${listen##*:}"
i=0
until curl -fsS "http://$probe:$port/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 30 ] || { journalctl -u wearden-core -n 40 --no-pager >&2 || true; die "core did not become healthy; see the log above"; }
  sleep 2
done

origin="$(env_value PUBLIC_ORIGIN)"
say ""
say "Wearden is running (service: wearden-core)."
say "  Open:        $origin"
say "  First step:  register on that page. The first account becomes the one and only administrator;"
say "               everyone who registers later waits for the administrator's approval."
say "  Agents:      in Wearden go to Assets, Agents, Enroll a new agent, and copy the one-line command."
case "$origin" in
  https://*) ;;
  *) say "  Note:        agents refuse plain http for a core on another machine. Put a TLS reverse proxy (Caddy or nginx) in front and set --url to its https address." ;;
esac
say "  Logs:        journalctl -u wearden-core -f"
say "  Upgrade:     run the installer again. Remove: add --uninstall (and --purge --yes to delete data)."
