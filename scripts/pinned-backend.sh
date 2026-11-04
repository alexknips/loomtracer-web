#!/usr/bin/env bash
# Print the local path to the pinned release binary. Downloads are checksum-verified.
# Shared by browser tests and the isolated shared-workspace integration test.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
version=$(tr -d '[:space:]' < "$root/LOOMTRACER_VERSION")
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid stable LOOMTRACER_VERSION." >&2; exit 2; }

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset=loomtracer-linux-x86_64 ;;
  Linux-aarch64 | Linux-arm64) asset=loomtracer-linux-arm64 ;;
  Darwin-arm64) asset=loomtracer-macos-arm64 ;;
  *) echo "No Loomtracer release binary for $(uname -s) $(uname -m)." >&2; exit 2 ;;
esac

dir="$root/.loomtracer-bin/$version"
if [ ! -x "$dir/loomtracer" ]; then
  mkdir -p "$dir"
  download=$(mktemp -d "$dir/download.XXXXXX")
  trap 'rm -rf "$download"' EXIT
  base="https://github.com/alexknips/loomtracer/releases/download/$version"
  curl -fsSL --connect-timeout 15 --max-time 180 -o "$download/$asset.tar.gz" "$base/$asset.tar.gz"
  curl -fsSL --connect-timeout 15 --max-time 30 -o "$download/$asset.tar.gz.sha256" "$base/$asset.tar.gz.sha256"
  (cd "$download" && if command -v sha256sum > /dev/null; then sha256sum -c "$asset.tar.gz.sha256"; else shasum -a 256 -c "$asset.tar.gz.sha256"; fi) >&2
  tar -xzf "$download/$asset.tar.gz" -C "$download" loomtracer
  chmod +x "$download/loomtracer"
  mv "$download/loomtracer" "$dir/loomtracer"
fi

printf '%s\n' "$dir/loomtracer"
