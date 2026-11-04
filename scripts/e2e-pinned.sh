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
LOOMTRACER_BIN=$(bash "$root/scripts/pinned-backend.sh")
export LOOMTRACER_BIN
echo "Browser tests against $("$LOOMTRACER_BIN" --version) ($LOOMTRACER_BIN)"

cd "$root"
npx --workspace=web playwright install chromium
npm run test:e2e --workspace=web -- "$@"
