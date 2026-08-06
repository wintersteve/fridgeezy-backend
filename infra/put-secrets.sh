#!/usr/bin/env bash
#
# Load the app's secrets from apps/api/.env into SSM Parameter Store, where the
# deployed function reads them at cold start.
#
# Values are never printed, never written to a temp file, and never passed
# through the shell's history — only key names and value lengths are shown, so
# the output is safe to paste into a ticket or a chat.
#
# Dry run by default, matching the convention the database scripts follow
# (`SEED_APPLY`, `DEDUP_APPLY`): it shows exactly what it would write and
# changes nothing until you set APPLY=true.
#
#   ./infra/put-secrets.sh                 # dry run
#   APPLY=true ./infra/put-secrets.sh      # actually write
#
#   ENVIRONMENT=prod APPLY=true ./infra/put-secrets.sh
#   AWS_PROFILE=steve APPLY=true ./infra/put-secrets.sh
#   ENV_FILE=/path/to/.env APPLY=true ./infra/put-secrets.sh
#
# Written as SecureString (encrypted with the account's default SSM KMS key).
# If a parameter already exists as a plain `String`, SSM will NOT silently
# change its type — this script deletes and recreates it, which is why it
# reports "recreated" rather than "updated" in that case.
#
# A parameter written here is picked up by the next cold start with no
# `terraform apply` — the function is given the prefix, not the values, and
# fetches by path. Rotating a key is this script plus a cold start, and nothing
# in Terraform state has to change because nothing sensitive is in it.
#
# The parameter's NAME becomes the environment variable's name, so a new secret
# needs no infra change: write it under the same prefix and read process.env for
# it. Add it to REQUIRED_KEYS in apps/api/src/load-secrets.ts if the app cannot
# boot without it.
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-dev}"
# Defaults to the region the tfvars use. Parameters are region-scoped: writing
# them to the wrong region is the failure this script exists to stop repeating,
# because `terraform plan` reports it as "couldn't find resource" with no hint
# that the parameter exists perfectly well somewhere else.
REGION="${AWS_REGION:-eu-central-1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/apps/api/.env}"
APPLY="${APPLY:-false}"

KEYS=(
    OPENAI_API_KEY
    GOOGLE_API_KEY
    SUPABASE_URL
    SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
)

command -v aws >/dev/null 2>&1 || { echo "aws CLI not found on PATH" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE" >&2; exit 1; }

# Parsed rather than sourced. Sourcing would execute the file, so a stray
# command in .env would run with your credentials — and this script exists
# precisely to be pointed at files holding secrets.
read_env() {
    local key="$1" line value
    line="$(grep -aE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n1 || true)"
    [ -n "$line" ] || return 1
    value="${line#*=}"
    value="${value%$'\r'}"                       # tolerate CRLF files
    value="${value%\"}"; value="${value#\"}"     # strip paired double quotes
    value="${value%\'}"; value="${value#\'}"     # strip paired single quotes
    printf '%s' "$value"
}

account="$(aws sts get-caller-identity --query Account --output text)"
caller="$(aws sts get-caller-identity --query Arn --output text)"

echo "account     $account"
echo "identity    $caller"
echo "region      $REGION"
echo "prefix      /fridgeezy/$ENVIRONMENT/"
echo "source      $ENV_FILE"
echo "mode        $([ "$APPLY" = "true" ] && echo 'APPLY — will write' || echo 'dry run — set APPLY=true to write')"
echo

missing=0
for key in "${KEYS[@]}"; do
    if ! value="$(read_env "$key")" || [ -z "$value" ]; then
        printf '  %-26s MISSING from %s\n' "$key" "$(basename "$ENV_FILE")"
        missing=1
        continue
    fi

    name="/fridgeezy/$ENVIRONMENT/$key"
    existing_type="$(aws ssm describe-parameters --region "$REGION" \
        --parameter-filters "Key=Name,Values=$name" \
        --query 'Parameters[0].Type' --output text 2>/dev/null || echo None)"

    if [ "$APPLY" != "true" ]; then
        printf '  %-26s would write (%s chars, currently: %s)\n' \
            "$key" "${#value}" "$existing_type"
        continue
    fi

    # SSM refuses to change an existing parameter's type in place, so a
    # parameter previously created as plaintext has to be removed first.
    if [ "$existing_type" = "String" ] || [ "$existing_type" = "StringList" ]; then
        aws ssm delete-parameter --name "$name" --region "$REGION" >/dev/null
        action="recreated as SecureString (was $existing_type)"
    elif [ "$existing_type" = "SecureString" ]; then
        action="updated"
    else
        action="created"
    fi

    aws ssm put-parameter --name "$name" --region "$REGION" \
        --type SecureString --value "$value" --overwrite >/dev/null

    printf '  %-26s %s (%s chars)\n' "$key" "$action" "${#value}"
done

echo
if [ "$missing" -eq 1 ]; then
    echo "one or more keys were missing — terraform plan will still fail on those" >&2
fi

if [ "$APPLY" != "true" ]; then
    echo "nothing written. Re-run with APPLY=true to apply."
    exit 0
fi

echo "in SSM now (names and types only):"
aws ssm describe-parameters --region "$REGION" \
    --parameter-filters "Key=Name,Values=/fridgeezy/$ENVIRONMENT/" \
    --query 'Parameters[].{Name:Name,Type:Type}' --output table

echo
echo "next: terraform -chdir=infra plan -var-file=environments/$ENVIRONMENT.tfvars"
