#!/usr/bin/env bash
# Hydrate .dev.vars and ~/.config/portfolio-2026.env from 1Password.
# Idempotent. Reads via the service account token at ~/.config/op-service-account-token.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -f "$HOME/.config/op-service-account-token" ]]; then
  echo "missing 1Password service-account token at ~/.config/op-service-account-token" >&2
  exit 1
fi
export OP_SERVICE_ACCOUNT_TOKEN="$(cat "$HOME/.config/op-service-account-token")"

OPENAI_KEY="$(op read 'op://MachineAuto/OPENAI_API_KEY/password')"
ELEVEN_KEY="$(op read 'op://MachineAuto/ELEVENLABS_API_KEY/password')"

# ElevenLabs voice id — try the operator-clone slot first; fall back to a known polished voice if missing.
ELEVEN_VOICE_ID="$(op read 'op://MachineAuto/ELEVENLABS_VOICE_JOHN_CLONE/password' 2>/dev/null || true)"
if [[ -z "${ELEVEN_VOICE_ID:-}" ]]; then
  # Default to "Brian" — Conversational, professional male voice. Replace via op item create when the John clone exists.
  ELEVEN_VOICE_ID="nPczCjzI2devNBz1zQrb"
fi

cat > "$PROJECT_DIR/.dev.vars" <<EOF
OPENAI_API_KEY=$OPENAI_KEY
ELEVENLABS_API_KEY=$ELEVEN_KEY
ELEVENLABS_VOICE_ID=$ELEVEN_VOICE_ID
SITE_VERSION=local
EOF
chmod 600 "$PROJECT_DIR/.dev.vars"
echo "wrote $PROJECT_DIR/.dev.vars"
