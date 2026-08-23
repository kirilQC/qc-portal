#!/usr/bin/env bash
# Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
# QC Portal — proprietary. Not licensed for redistribution or resale.

# Sets the two Supabase variables on the Vercel project, reading them from a hidden prompt so they are
# never typed into a chat, never written to a file, and never left in shell history.
#
# Why this exists: Vercel marks these variables "sensitive" on the Reply Radar project, which means it
# will not return their values to anyone or anything — not the CLI, not the API, not the dashboard.
# That is the correct behaviour and it is why they have to be supplied by hand exactly once.
#
# Get them from: Supabase dashboard → your project → Settings → API
#   Project URL  → SUPABASE_URL              (looks like https://abcdefgh.supabase.co)
#   service_role → SUPABASE_SERVICE_ROLE_KEY (the long secret one, NOT anon/public)
#
# Usage:  bash scripts/set-supabase-env.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .vercel/project.json ]; then
  echo "This directory is not linked to a Vercel project. Run: npx vercel link"
  exit 1
fi

printf 'Supabase Project URL: '
read -r SUPABASE_URL
printf 'Supabase service_role key (hidden): '
read -rs SUPABASE_SERVICE_ROLE_KEY
printf '\n\n'

# Fail early on the two mistakes that otherwise surface much later as "sign in is unavailable".
case "$SUPABASE_URL" in
  https://*.supabase.co|https://*.supabase.in|https://*.supabase.*) ;;
  *) echo "That does not look like a Supabase URL (expected https://<project>.supabase.co)."; exit 1 ;;
esac
if [ "${#SUPABASE_SERVICE_ROLE_KEY}" -lt 40 ]; then
  echo "That key looks too short — make sure it is the service_role key, not a placeholder."
  exit 1
fi

for TARGET in production preview development; do
  for NAME in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    # Remove any existing value first; `env add` refuses to overwrite.
    npx --yes vercel@latest env rm "$NAME" "$TARGET" --yes >/dev/null 2>&1 || true
    printf '%s' "$(eval echo "\$$NAME")" | npx --yes vercel@latest env add "$NAME" "$TARGET" >/dev/null 2>&1
  done
  echo "set $TARGET"
done

echo
echo "Done. Now redeploy so the new values are picked up:"
echo "  npx vercel deploy --prod --yes"
echo
echo "Then check:  curl -s https://<your-deployment>/api/health"
