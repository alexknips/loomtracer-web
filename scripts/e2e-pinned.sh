#!/usr/bin/env bash
# Runs the browser tests (web/e2e) against the pinned Loomtracer release.
#
# The tests start a scratch `loomtracer serve` (web/e2e/support/serve-scratch.mjs), so they need a
# backend binary. This downloads the release named in LOOMTRACER_VERSION, checks its .sha256, and
# runs Playwright with LOOMTRACER_BIN pointing at it. To raise the pin, edit LOOMTRACER_VERSION.
#
# Usage: scripts/e2e-pinned.sh [playwright args...]
#   e.g. scripts/e2e-pinned.sh --reporter=line
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
version=$(tr -d '[:space:]' < "$root/LOOMTRACER_VERSION")
[ -n "$version" ] || { echo "LOOMTRACER_VERSION is empty." >&2; exit 2; }

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset=loomtracer-linux-x86_64 ;;
  Linux-aarch64 | Linux-arm64) asset=loomtracer-linux-arm64 ;;
  Darwin-arm64) asset=loomtracer-macos-arm64 ;;
  *) echo "No Loomtracer release binary for $(uname -s) $(uname -m)." >&2; exit 2 ;;
esac

dir="$root/.loomtracer-bin/$version"
if [ ! -x "$dir/loomtracer" ]; then
  mkdir -p "$dir"
  base="https://github.com/alexknips/loomtracer/releases/download/$version"
  curl -fsSL -o "$dir/$asset.tar.gz" "$base/$asset.tar.gz"
  curl -fsSL -o "$dir/$asset.tar.gz.sha256" "$base/$asset.tar.gz.sha256"
  # The .sha256 file reads "<hash>  <archive name>", so check it from inside the directory.
  (cd "$dir" && if command -v sha256sum > /dev/null; then sha256sum -c "$asset.tar.gz.sha256"; else shasum -a 256 -c "$asset.tar.gz.sha256"; fi)
  tar -xzf "$dir/$asset.tar.gz" -C "$dir" loomtracer
fi

export LOOMTRACER_BIN="$dir/loomtracer"
echo "Browser tests against $("$LOOMTRACER_BIN" --version) ($version, $LOOMTRACER_BIN)"

cd "$root"
npx --workspace=web playwright install chromium
npm run test:e2e --workspace=web -- "$@"
