#!/usr/bin/env bash
# Build + deploy to Cloudflare Pages preview.
# Returns the preview URL on success.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -f "$HOME/.config/op-service-account-token" ]]; then
  echo "ERROR: 1Password service-account token missing." >&2
  exit 1
fi
export OP_SERVICE_ACCOUNT_TOKEN="$(cat "$HOME/.config/op-service-account-token")"
export CLOUDFLARE_API_TOKEN="$(op read 'op://MachineAutoBiz/CLOUDFLARE_API_TOKEN_FLEET/password')"
export CLOUDFLARE_ACCOUNT_ID="$(op read 'op://MachineAutoBiz/CLOUDFLARE_ACCOUNT_ID/password')"

# Ensure local env is hydrated.
bash "$PROJECT_DIR/scripts/setup-env.sh" >/dev/null

echo "[1/3] build"
/home/ubuntu/bin/npm run build

echo "[2/3] deploy"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo preview)"
/home/ubuntu/bin/wrangler pages deploy ./dist \
  --project-name=portfolio-2026 \
  --branch="$BRANCH" 2>&1 | tee .tmp/deploy.log

echo "[3/3] extract preview URL"
URL="$(grep -oE 'https://[a-z0-9-]+\.portfolio-2026\.pages\.dev' .tmp/deploy.log | tail -1 || true)"
if [[ -z "$URL" ]]; then
  URL="$(grep -oE 'https://[a-z0-9-]+\.pages\.dev' .tmp/deploy.log | tail -1 || true)"
fi
echo
echo "preview: $URL"
echo "$URL" > .tmp/preview-url.txt
