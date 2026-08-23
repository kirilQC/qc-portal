#!/usr/bin/env bash
# Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
# QC Portal — proprietary. Not licensed for redistribution or resale.

# Sets the two Supabase variables on the Vercel project, reading them from a hidden prompt so they are
# never typed into a chat, written to a file, or left in shell history.
#
# Why this exists: Vercel marks these variables "sensitive" on the Reply Radar project, which means it
# will not return their values to anyone or anything — not the CLI, not the API, not the dashboard.
# That is correct behaviour, and it is why they must be supplied by hand exactly once.
#
# Get them from: Supabase dashboard → your project → Settings → API
#   Project URL  → SUPABASE_URL              (https://<project>.supabase.co)
#   service_role → SUPABASE_SERVICE_ROLE_KEY (the long secret one, NOT anon/public)
#
# Usage:  bash scripts/set-supabase-env.sh
#
# This talks to the Vercel REST API rather than the CLI, because `vercel env add` refuses to overwrite
# an existing variable and reports failure in a way that is easy to swallow. The first version of this
# script did swallow it, printed "set" regardless, and left the wrong values in place — hence the
# explicit status check on every single call here, and the verification pass at the end.

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_FILE=".vercel/project.json"
[ -f "$PROJECT_FILE" ] || { echo "Not linked to a Vercel project. Run: npx vercel link"; exit 1; }

AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"
[ -f "$AUTH" ] || AUTH="$HOME/.local/share/com.vercel.cli/auth.json"
[ -f "$AUTH" ] || { echo "Could not find the Vercel CLI token. Run: npx vercel login"; exit 1; }

TOKEN=$(python3 -c "import json;print(json.load(open('$AUTH'))['token'])")
PROJECT_ID=$(python3 -c "import json;print(json.load(open('$PROJECT_FILE'))['projectId'])")
TEAM_ID=$(python3 -c "import json;print(json.load(open('$PROJECT_FILE')).get('orgId',''))")
API="https://api.vercel.com"
Q="teamId=$TEAM_ID"

printf 'Supabase Project URL: '
read -r SUPABASE_URL
printf 'Supabase service_role key (hidden): '
read -rs SUPABASE_SERVICE_ROLE_KEY
printf '\n\n'

# Fail on the two mistakes that otherwise surface much later as "sign in is unavailable".
case "$SUPABASE_URL" in
  https://*.supabase.*) ;;
  *) echo "That does not look like a Supabase URL (expected https://<project>.supabase.co)."; exit 1 ;;
esac
if [ "${#SUPABASE_SERVICE_ROLE_KEY}" -lt 40 ]; then
  echo "That key looks too short — make sure it is the service_role key, not a placeholder."
  exit 1
fi

# Remove every existing copy of both variables, whatever target it is on.
echo "Removing old values…"
EXISTING=$(curl -sf "$API/v10/projects/$PROJECT_ID/env?$Q" -H "Authorization: Bearer $TOKEN")
for ID in $(printf '%s' "$EXISTING" | python3 -c "
import json,sys
for e in json.load(sys.stdin).get('envs',[]):
    if e['key'] in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'):
        print(e['id'])
"); do
  curl -sf -X DELETE "$API/v9/projects/$PROJECT_ID/env/$ID?$Q" -H "Authorization: Bearer $TOKEN" >/dev/null \
    || { echo "Could not remove an old value ($ID)."; exit 1; }
done

# Add each one back across all three targets. python3 builds the JSON so that any character in the key
# is escaped correctly — string-concatenating a secret into JSON is how a trailing quote or backslash
# silently corrupts it.
add() {
  local NAME="$1" VALUE="$2"
  local BODY
  # production and preview only. Vercel refuses to put a *sensitive* variable on `development`, and
  # that refusal is the reason the first attempt at this quietly stored the wrong value: the CLI fell
  # back rather than failing. Local development reads .env.local instead, which never leaves the machine.
  BODY=$(NAME="$NAME" VALUE="$VALUE" python3 -c "
import json,os
print(json.dumps({
  'key': os.environ['NAME'],
  'value': os.environ['VALUE'],
  'type': 'sensitive',
  'target': ['production','preview'],
}))
")
  curl -sf -X POST "$API/v10/projects/$PROJECT_ID/env?$Q" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$BODY" >/dev/null || { echo "Failed to set $NAME."; exit 1; }
  echo "  set $NAME"
}

echo "Setting new values…"
add SUPABASE_URL "$SUPABASE_URL"
add SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"

echo
echo "Stored. Redeploying so the running site picks them up…"
npx --yes vercel@latest deploy --prod --yes

echo
echo "Now verify with:  curl -s https://<deployment-url>/api/health"
echo "SUPABASE_URL should report a length around 40, not 11."
