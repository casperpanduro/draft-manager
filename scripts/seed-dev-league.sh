#!/usr/bin/env bash
# Seed a ready-to-play demo league of test managers with preselected squads.
#
#   npm run db:seed-dev          # squads drafted, season open at round 1
#   npm run db:seed-dev -- 2     # also pre-play 2 rounds (history to browse)
#
# Creates the auth users (so they can sign in via magic link), then builds the
# league. Log in as gaffer@demo.dev — the magic link lands in Mailpit
# (http://127.0.0.1:54324). Re-running rebuilds the "Demo Season" league.
set -euo pipefail
cd "$(dirname "$0")/.."

SB="${SUPABASE_URL:-http://127.0.0.1:54321}"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_draft-manager}"
ROUNDS="${1:-0}"

if [[ ! -f .env.local ]]; then
  echo "✗ .env.local not found — run from the project root after 'supabase start'." >&2
  exit 1
fi
SRK="$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)"
if [[ -z "${SRK:-}" ]]; then
  echo "✗ SUPABASE_SERVICE_ROLE_KEY missing from .env.local." >&2
  exit 1
fi

MANAGERS=("gaffer@demo.dev" "alex@demo.dev" "sam@demo.dev" "jordan@demo.dev")

echo "→ Creating ${#MANAGERS[@]} test managers…"
for email in "${MANAGERS[@]}"; do
  curl -s -o /dev/null -X POST "$SB/auth/v1/admin/users" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"email_confirm\":true}" || true
done

echo "→ Building league (pre-playing $ROUNDS round(s))…"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -q -v rounds="$ROUNDS" \
  < scripts/seed-dev-league.sql

echo "✓ Done. Sign in as gaffer@demo.dev — magic link in Mailpit: http://127.0.0.1:54324"
