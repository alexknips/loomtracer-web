#!/usr/bin/env bash
# No caller-supplied endpoint or data directory: the runner owns its scratch server.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
binary=$(bash "$root/scripts/pinned-backend.sh")
exec node "$root/scripts/shared-workspace/run.mjs" --binary "$binary"
