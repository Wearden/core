#!/bin/sh
# Publishes a release under YOUR GitHub account (not the Actions bot) with readable asset names and plain notes.
# The tag workflow only builds and stores the files; run this after it finishes:
#   sh scripts/publish-release.sh core v0.1.0          (also: agent-linux, agent-windows)
# Optional third argument: a folder that already holds the files (otherwise they are taken from the workflow run).
set -eu
REPO="${1:?repo: core, agent-linux or agent-windows}"; TAG="${2:?tag, for example v0.1.0}"; DIR="${3:-}"
SLUG="Wearden/$REPO"
if [ -z "$DIR" ]; then
  DIR="$(mktemp -d)"
  RUN="$(gh run list --repo "$SLUG" --branch "$TAG" --limit 1 --json databaseId,conclusion --jq '.[0] | select(.conclusion=="success") | .databaseId')"
  [ -n "$RUN" ] || { echo "no successful workflow run for $TAG in $SLUG" >&2; exit 1; }
  gh run download "$RUN" --repo "$SLUG" --name release-assets --dir "$DIR"
fi
label() {
  case "$1" in
    wearden-core-linux-amd64.tar.gz) echo "Core server for Linux (x86_64, .tar.gz)" ;;
    wearden-core-windows-amd64.zip) echo "Core server for Windows (x64, .zip)" ;;
    install-core.sh) echo "Core installer for Linux (install-core.sh)" ;;
    install-core.ps1) echo "Core installer for Windows (install-core.ps1)" ;;
    wearden-agent-linux-amd64) echo "Agent for Linux (x86_64)" ;;
    wearden-agent-windows-amd64.exe) echo "Agent for Windows (x64, .exe)" ;;
    SHA256SUMS) echo "Checksums (SHA256)" ;;
    *) echo "$1" ;;
  esac
}
case "$REPO" in
  core) NOTES="Wearden core $TAG. Pick the file for your system: the core server for Linux or Windows (the dashboard is inside), or an installer.

Linux: curl -fsSL https://github.com/$SLUG/releases/latest/download/install-core.sh | sudo sh
Windows: download install-core.ps1 and run it in an elevated PowerShell (see the README).

Every file is listed in SHA256SUMS." ;;
  agent-linux) NOTES="Wearden agent for Linux x86_64, $TAG. Normally installed from your core with one command (Assets, Agents, Enroll a new agent). Check the file against SHA256SUMS." ;;
  agent-windows) NOTES="Wearden agent for Windows x64, $TAG. Normally served by your core. Check the file against SHA256SUMS." ;;
  *) echo "unknown repo" >&2; exit 1 ;;
esac
set -- ; for f in "$DIR"/*; do set -- "$@" "$f#$(label "$(basename "$f")")"; done
gh release create "$TAG" "$@" --repo "$SLUG" --title "Wearden $REPO $TAG" --notes "$NOTES"
