#!/usr/bin/env bash
# Copies keys from .env.local into this repo's GitHub Actions secrets.
# Values are piped straight to `gh` and never printed.
# Usage (from the project folder):  bash scripts/sync-github-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

KEYS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  AGENT_USER_ID
  AGENT_SECRET
  GEMINI_API_KEY
  GROQ_API_KEY
  OPENROUTER_API_KEY
  GMAIL_REFRESH_TOKEN
  VAULT_KEY
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
)

for k in "${KEYS[@]}"; do
  v=$(grep -m1 "^${k}=" .env.local | cut -d= -f2- | tr -d '\r' || true)
  v="${v#\"}"; v="${v%\"}"
  if [ -n "$v" ]; then
    printf '%s' "$v" | gh secret set "$k" >/dev/null
    echo "updated  $k"
  else
    echo "skipped  $k (empty in .env.local)"
  fi
done

# Turns on live scheduled runs.
printf 'true' | gh secret set LIVE_AGENT_ENABLED >/dev/null
echo "updated  LIVE_AGENT_ENABLED=true"
