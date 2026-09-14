#!/usr/bin/env bash
#
# Send a synthetic RevenueCat-shaped event at the DEV webhook, so the entitlement
# chain can be exercised without a real purchase.
#
#   ./infra/send-webhook-event.sh INITIAL_PURCHASE
#   ./infra/send-webhook-event.sh RENEWAL
#   ./infra/send-webhook-event.sh CANCELLATION
#   ./infra/send-webhook-event.sh EXPIRATION
#   ./infra/send-webhook-event.sh REFUND
#   ./infra/send-webhook-event.sh TEST
#
#   USER_ID=<uuid> ./infra/send-webhook-event.sh RENEWAL   # pick the subject
#   TARGET=local ./infra/send-webhook-event.sh INITIAL_PURCHASE
#
# ## TARGET=local, and why it is not optional any more
#
# RevenueCat delivers webhooks to ONE configured URL, the deployed Function URL,
# so a Test Store purchase made against a local `npm run api:dev` grants the
# entitlement on the DEVICE and writes the row into the REMOTE Supabase. The
# local stack never hears about it. That did not matter while the paid gate was
# behind `REQUIRE_ENTITLEMENT` and off by default; with the gate unconditional
# (2026-09-04) it is the difference between a working local API and one that
# 402s the home feed's generation. So this is now the supported way to hold an
# entitlement locally, and `TARGET=local` reads its secret and its database out
# of `apps/api/.env{,.dev}` rather than SSM and posts at `API_URL`
# (default `http://127.0.0.1:8000`).
#
# It prints the `profile_entitlements` row before and after, because the row is
# the thing under test — the handler answers 200 for "applied" and for "ignored
# as stale" alike, so the log line alone cannot tell you which happened.
#
# ## Why this exists
#
# A local StoreKit configuration file cannot produce CANCELLATION or EXPIRATION:
# Apple does not put those in the receipt, so they never reach RevenueCat and no
# webhook is generated. They are also the two events whose handling is easiest to
# get wrong and worst to get wrong — CANCELLATION deliberately does NOT revoke
# (the user keeps access to their paid-for expiry) and EXPIRATION carries a past
# timestamp rather than a revocation. Without this script neither path is
# reachable at all until a real subscription is sold and then left to lapse.
#
# ## This writes entitlements with no purchase behind it. What stops it hitting prod:
#
# 1. The function name is pinned to dev and VALIDATED, not merely defaulted — an
#    override that is not a `-dev-` function is refused below.
# 2. The secret is read from `/fridgeezy/dev/`, and the two environments hold
#    DIFFERENT secrets. So even if the URL were somehow pointed at prod, prod
#    compares against its own value and answers 401. The guard is defence in
#    depth on top of that; the differing secrets are the actual protection.
# 3. Every event is stamped `environment: SANDBOX`, so any row it creates is
#    distinguishable from a real purchase in the table itself.
# 4. `TARGET=local` cannot reach either deployment: it never resolves a Function
#    URL and refuses a non-loopback `API_URL`.
# ## It is not the only writer any more
#
# Since 2026-09-13 the API also reconciles `profile_entitlements` against
# RevenueCat's REST API, whenever `REVENUECAT_SECRET_API_KEY` is set. A row this
# script fabricated has no purchase behind it, so the first check correctly
# expires it — usually within seconds, which will look exactly like this script
# not working. That is the trade, and it is the right way round: leave the key
# unset locally when you want an entitlement to test WITH, and set it when you
# want the local database to tell you the truth.
set -euo pipefail

TARGET="${TARGET:-dev}"
FUNCTION_NAME="${FUNCTION_NAME:-fridgeezy-dev-api}"
REGION="${AWS_REGION:-eu-central-1}"
SSM_PREFIX="/fridgeezy/dev"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$TARGET" in
    dev|local) ;;
    *)
        echo "refusing: TARGET='$TARGET' is not 'dev' or 'local'." >&2
        exit 1
        ;;
esac

# The guard. Pinning by default is not enough — someone will export
# FUNCTION_NAME for an unrelated reason and this must not quietly follow it.
if [ "$TARGET" = "dev" ]; then
    case "$FUNCTION_NAME" in
        *-dev-*) ;;
        *)
            echo "refusing: FUNCTION_NAME='$FUNCTION_NAME' is not a dev function." >&2
            echo "This script fabricates entitlements and is dev-only by design." >&2
            exit 1
            ;;
    esac
fi

EVENT_TYPE="${1:-}"

case "$EVENT_TYPE" in
    INITIAL_PURCHASE|RENEWAL|CANCELLATION|EXPIRATION|REFUND|TEST|CLEAR) ;;
    *)
        echo "usage: $0 <INITIAL_PURCHASE|RENEWAL|CANCELLATION|EXPIRATION|REFUND|TEST|CLEAR>" >&2
        echo "       CLEAR deletes the synthetic row so the next run starts from nothing." >&2
        exit 1
        ;;
esac

command -v python3 >/dev/null 2>&1 || { echo "python3 not found on PATH" >&2; exit 1; }

# Reads one key out of a dotenv file, quotes stripped. Deliberately not `source`:
# these files are Nx's, not this script's, and sourcing them would drop every
# other key they hold — OPENAI_API_KEY among them — into this shell.
dotenv() {
    python3 -c '
import pathlib, re, sys
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
if not path.exists():
    sys.exit(1)
for line in path.read_text().splitlines():
    match = re.match(rf"\s*(?:export\s+)?{re.escape(key)}\s*=\s*(.*)", line)
    if match:
        print(match.group(1).strip().strip("\"\x27"))
        sys.exit(0)
sys.exit(1)
' "$1" "$2"
}

if [ "$TARGET" = "local" ]; then
    URL="${API_URL:-http://127.0.0.1:8000}"

    # The local counterpart of the dev-function guard. Without it, exporting
    # API_URL for an unrelated reason would point a script that fabricates
    # entitlements at a real deployment.
    case "$URL" in
        http://127.0.0.1:*|http://localhost:*) ;;
        *)
            echo "refusing: API_URL='$URL' is not loopback." >&2
            echo "TARGET=local fabricates entitlements against the local stack only." >&2
            exit 1
            ;;
    esac

    URL="${URL%/}/rest/billing/revenuecat"

    # `.env` holds the shared secret and `.env.dev` the local Supabase, which is
    # exactly how `api:serve:dev` loads them — so the secret this signs with is
    # by construction the one the running API compares against.
    SECRET="$(dotenv "$REPO_ROOT/apps/api/.env" REVENUECAT_WEBHOOK_SECRET)" || {
        echo "no REVENUECAT_WEBHOOK_SECRET in apps/api/.env" >&2
        exit 1
    }

    SUPABASE_URL="$(dotenv "$REPO_ROOT/apps/api/.env.dev" SUPABASE_URL)"
    SERVICE_KEY="$(dotenv "$REPO_ROOT/apps/api/.env.dev" SUPABASE_SERVICE_ROLE_KEY)"
else
    command -v aws >/dev/null 2>&1 || { echo "aws CLI not found on PATH" >&2; exit 1; }

    ssm() {
        aws ssm get-parameter --name "$SSM_PREFIX/$1" --with-decryption \
            --region "$REGION" --query 'Parameter.Value' --output text
    }

    SECRET="$(ssm REVENUECAT_WEBHOOK_SECRET)" || {
        echo "no $SSM_PREFIX/REVENUECAT_WEBHOOK_SECRET in SSM — run put-secrets.sh first" >&2
        exit 1
    }

    URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" \
        --region "$REGION" --query FunctionUrl --output text)"
    URL="${URL%/}/rest/billing/revenuecat"

    SUPABASE_URL="$(ssm SUPABASE_URL)"
    SERVICE_KEY="$(ssm SUPABASE_SERVICE_ROLE_KEY)"
fi

# A real auth.users id is required: profile_entitlements.user_id is a foreign key
# to it, so a made-up uuid fails the insert and surfaces as a 500 from the
# handler — which reads as "the webhook is broken" rather than "that user does
# not exist".
if [ -z "${USER_ID:-}" ]; then
    USER_ID="$(curl -fsS "$SUPABASE_URL/rest/v1/profiles?select=user_id&order=created_at.desc&limit=1" \
        -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
        | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["user_id"] if rows else "")')"
fi

[ -n "$USER_ID" ] || { echo "no USER_ID given and no profile found to use" >&2; exit 1; }

row() {
    curl -fsS "$SUPABASE_URL/rest/v1/profile_entitlements?user_id=eq.$USER_ID&select=entitlement_id,product_id,environment,expires_at,revoked_at,last_event_at" \
        -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
        | python3 -m json.tool
}

if [ "$EVENT_TYPE" = "CLEAR" ]; then
    # Only ever the SANDBOX row, so this cannot delete a real entitlement even if
    # one somehow existed in dev.
    curl -fsS -X DELETE \
        "$SUPABASE_URL/rest/v1/profile_entitlements?user_id=eq.$USER_ID&environment=eq.SANDBOX" \
        -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null
    echo "cleared synthetic entitlement for $USER_ID"
    exit 0
fi

# A real CANCELLATION carries the expiry the subscription ALREADY has — turning
# off auto-renew changes nothing about when access ends. Reading the stored value
# rather than inventing one is what makes the cancel-then-check test meaningful:
# with a fixed offset, cancelling after a renewal appeared to SHORTEN access, so
# the script contradicted the very behaviour it exists to demonstrate.
CURRENT_EXPIRY="$(curl -fsS \
    "$SUPABASE_URL/rest/v1/profile_entitlements?user_id=eq.$USER_ID&select=expires_at" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r[0]["expires_at"] if r and r[0].get("expires_at") else "")')"

PAYLOAD="$(EVENT_TYPE="$EVENT_TYPE" USER_ID="$USER_ID" CURRENT_EXPIRY="$CURRENT_EXPIRY" python3 - <<'PY'
import datetime, json, os, time, uuid

event_type = os.environ["EVENT_TYPE"]
now_ms = int(time.time() * 1000)
day_ms = 86_400_000

# The expiry already on the row, if there is one. Falls back to a fresh 30 days
# so the cancel/refund events still work as a first action.
stored = os.environ.get("CURRENT_EXPIRY") or ""
if stored:
    kept = int(
        datetime.datetime.fromisoformat(stored.replace("Z", "+00:00")).timestamp() * 1000
    )
else:
    kept = now_ms + 30 * day_ms

# EXPIRATION is the one that must land in the PAST: the activity rule is derived
# (`expires_at > now()`), so an expiry ahead of now would report the subscription
# as still live and the event would look like it had done nothing.
expiry = {
    "INITIAL_PURCHASE": now_ms + 30 * day_ms,
    "RENEWAL": now_ms + 60 * day_ms,
    # Unchanged expiry on purpose. Cancelling turns off auto-renew; access runs
    # to the date already paid for, and REVOKING_EVENTS deliberately omits this.
    "CANCELLATION": kept,
    "EXPIRATION": now_ms - day_ms,
    "REFUND": kept,
    "TEST": now_ms,
}[event_type]

print(json.dumps({
    "api_version": "1.0",
    "event": {
        "id": str(uuid.uuid4()),
        "type": event_type,
        "app_user_id": os.environ["USER_ID"],
        "event_timestamp_ms": now_ms,
        "product_id": "com.anonymous.fridgeezy.Monthly",
        "entitlement_ids": ["premium"],
        "expiration_at_ms": expiry,
        "store": "APP_STORE",
        # Marks every row this script produces as synthetic.
        "environment": "SANDBOX",
    },
}))
PY
)"

echo "target      $TARGET"
if [ "$TARGET" = "dev" ]; then echo "function    $FUNCTION_NAME"; fi
echo "url         $URL"
echo "event       $EVENT_TYPE"
echo "subject     $USER_ID"
echo
echo "row before:"
row
echo
echo "response:"
curl -sS -X POST "$URL" \
    -H "Authorization: $SECRET" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    -w '\n[HTTP %{http_code}]\n'

# The write is committed before the handler answers, so there is no need to wait.
echo
echo "row after:"
row
