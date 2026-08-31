#!/usr/bin/env bash
#
# Push ONLY the magic-link email subject and template to the hosted project.
#
# **Do not use `supabase config push` for this.** That command sends the whole
# `[auth]` block, and this repo's `config.toml` is the LOCAL stack's config —
# `site_url` is 127.0.0.1:3000, the rate limit is 2 mails an hour, and
# `[auth.external.apple]` is `enabled = false` while production ships Apple
# Sign-In. Pushing it would point prod's redirects at localhost and turn Apple
# off. This script PATCHes two fields and touches nothing else.
#
# Needs a Supabase personal access token — from SUPABASE_ACCESS_TOKEN, or the
# one `supabase login` left in the macOS keychain.
#
#   ./operations/push-magic-link-template.sh            # show remote, then ask
#   ./operations/push-magic-link-template.sh --check    # show remote only
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-qkxznjwlybjqpcauaisz}"
TEMPLATE="$(dirname "$0")/../supabase/templates/magic-link.html"
SUBJECT="Your Fridgeezy sign-in code"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth"

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN="$(security find-generic-password -s 'Supabase CLI' -a 'access-token' -w 2>/dev/null || true)"
fi
if [ -z "$TOKEN" ]; then
  echo "No token. Export SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)." >&2
  exit 1
fi

echo "== remote magic-link template, before =="
curl -sf -H "Authorization: Bearer $TOKEN" "$API" | python3 -c '
import sys, json
d = json.load(sys.stdin)
subject = d.get("mailer_subjects_magic_link") or "(default)"
body = d.get("mailer_templates_magic_link_content") or ""
print("subject:", subject)
print("custom template:", "yes" if body else "no — hosted default")
print("contains {{ .Token }}:", "YES" if ".Token" in body else "NO  <- the code can never arrive")
'

if [ "${1:-}" = "--check" ]; then exit 0; fi

read -r -p "Overwrite the hosted magic-link template? [y/N] " reply
[ "$reply" = "y" ] || { echo "aborted"; exit 0; }

python3 -c '
import json, sys
print(json.dumps({
    "mailer_subjects_magic_link": sys.argv[1],
    "mailer_templates_magic_link_content": open(sys.argv[2]).read(),
}))
' "$SUBJECT" "$TEMPLATE" \
| curl -sf -X PATCH "$API" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @- \
| python3 -c '
import sys, json
d = json.load(sys.stdin)
body = d.get("mailer_templates_magic_link_content") or ""
print("pushed. subject:", d.get("mailer_subjects_magic_link"))
print("contains {{ .Token }}:", "YES" if ".Token" in body else "NO")
'
