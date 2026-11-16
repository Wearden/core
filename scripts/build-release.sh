#!/bin/sh
# Builds the core release assets: one self-contained archive per operating system plus the installers and checksums.
# Run it from the folder that holds core, proto and ruleset side by side (the release workflow does exactly that):
#   sh core/scripts/build-release.sh v1.0.0
# Needs Go, Node with npm, tar and zip. Output goes to ./release.
set -eu

VERSION="${1:-dev}"
OUT="${OUT:-$PWD/release}"
for d in core proto ruleset; do [ -d "$d" ] || { echo "error: run this from the folder that contains $d/" >&2; exit 1; }; done
for t in go npm tar zip sha256sum; do command -v "$t" >/dev/null 2>&1 || { echo "error: missing tool: $t" >&2; exit 1; }; done

rm -rf "$OUT"
mkdir -p "$OUT"

echo "Building the dashboard ..."
(cd core/frontend && npm install --no-audit --no-fund && npm run build)
find core/internal/webui/site -mindepth 1 ! -name .gitkeep -delete
cp -R core/frontend/dist/. core/internal/webui/site/

if [ ! -f go.work ]; then
  go work init ./proto ./core
  go work edit -replace=github.com/Wearden/proto@v0.0.0=./proto
  go work sync
fi

stage_common() {
  dir="$1"
  mkdir -p "$dir"
  tar -C ruleset --exclude=.git -cf - . | (mkdir -p "$dir/ruleset" && tar -C "$dir/ruleset" -xf -)
  cp core/LICENSE core/THIRD_PARTY_NOTICES.md "$dir/"
  printf '%s\n' "$VERSION" > "$dir/VERSION"
}

echo "Building core for Linux ..."
stage="$OUT/stage-linux"
stage_common "$stage"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$stage/wearden-core" ./core/cmd/core
tar -C "$stage" -czf "$OUT/wearden-core-linux-amd64.tar.gz" .

echo "Building core for Windows ..."
stage="$OUT/stage-windows"
stage_common "$stage"
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$stage/wearden-core.exe" ./core/cmd/core
(cd "$stage" && zip -qr "$OUT/wearden-core-windows-amd64.zip" .)

rm -rf "$OUT/stage-linux" "$OUT/stage-windows"
cp core/scripts/install-core.sh core/scripts/install-core.ps1 "$OUT/"
(cd "$OUT" && sha256sum wearden-core-linux-amd64.tar.gz wearden-core-windows-amd64.zip install-core.sh install-core.ps1 > SHA256SUMS)
echo "Release assets in $OUT:"
ls -l "$OUT"
