#!/usr/bin/env bash
#
# Mint the SMTP credentials Supabase authenticates to SES with, and print them
# once.
#
#   ./infra/create-ses-smtp-credentials.sh                 # dry run
#   APPLY=true ./infra/create-ses-smtp-credentials.sh      # actually create
#
# WHY THIS IS NOT TERRAFORM. `aws_iam_access_key` exposes the derived password
# as `ses_smtp_password_v4`, which is by far the shortest way to do this and is
# the one thing versions.tf forbids outright: the S3 backend is only safe
# because nothing sensitive reaches state, and the bucket is versioned, so a
# password written there once cannot be taken back out. Terraform owns the IAM
# user and its policy (dns.tf); this owns the key.
#
# The SMTP password is not the secret access key. It is an HMAC-SHA256 chain
# over the AWS Signature Version 4 key-derivation path, ending in a version
# byte and base64 — Amazon documents it, and it is reimplemented here rather
# than shelled out to because there is no CLI for it. It is derived from the
# secret locally: nothing is sent anywhere.
#
# ROTATION. IAM allows two access keys per user, so rotate by creating the
# second, pasting it into Supabase, confirming a sign-in code arrives, and only
# then deleting the first:
#
#   aws iam list-access-keys --user-name <user>
#   aws iam delete-access-key --user-name <user> --access-key-id <old>
#
# The script refuses to create a third, because IAM would fail anyway and it is
# better to say which two exist.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APPLY="${APPLY:-false}"

REGION="$(terraform -chdir=infra output -raw site_mail_region 2>/dev/null || true)"
USER_NAME="$(terraform -chdir=infra output -raw ses_smtp_user_name 2>/dev/null || true)"

if [ -z "$USER_NAME" ]; then
    echo "no ses_smtp_user_name output — has 'terraform apply' run with site_domain set?" >&2
    exit 1
fi

echo "user:   $USER_NAME"
echo "region: $REGION"
echo "host:   email-smtp.$REGION.amazonaws.com  (port 587, STARTTLS)"
echo

EXISTING="$(aws iam list-access-keys --user-name "$USER_NAME" \
    --query 'AccessKeyMetadata[].[AccessKeyId,Status,CreateDate]' --output text || true)"

if [ -n "$EXISTING" ]; then
    echo "existing keys:"
    echo "$EXISTING" | sed 's/^/  /'
    echo
    COUNT="$(printf '%s\n' "$EXISTING" | grep -c . || true)"
    if [ "$COUNT" -ge 2 ]; then
        echo "two keys already exist — IAM allows no more. Delete the older one" >&2
        echo "first (see the rotation note in this script's header)." >&2
        exit 1
    fi
fi

if [ "$APPLY" != "true" ]; then
    echo "dry run — would create one access key for $USER_NAME"
    echo "re-run with APPLY=true to create it"
    exit 0
fi

KEY_JSON="$(aws iam create-access-key --user-name "$USER_NAME" --output json)"

# The secret is held in a shell variable and a python heredoc and never written
# to a file, echoed as itself, or passed as an argv (which `ps` would show).
SMTP_USER="$(printf '%s' "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')"
SMTP_PASS="$(printf '%s' "$KEY_JSON" | REGION="$REGION" python3 -c '
import base64, hmac, json, os, sys
from hashlib import sha256

secret = json.load(sys.stdin)["AccessKey"]["SecretAccessKey"]
region = os.environ["REGION"]

# Amazon SES SMTP password derivation. The message at each step and the final
# version byte are fixed by AWS; the date is the literal string 11111111, not a
# real date, which is what makes the result stable rather than expiring.
def sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), sha256).digest()

signature = sign(("AWS4" + secret).encode("utf-8"), "11111111")
signature = sign(signature, region)
signature = sign(signature, "ses")
signature = sign(signature, "aws4_request")
signature = sign(signature, "SendRawEmail")

print(base64.b64encode(bytes([0x04]) + signature).decode("utf-8"))
')"

cat <<EOF

created. Paste into Supabase → Project Settings → Authentication → SMTP:

  Host      email-smtp.$REGION.amazonaws.com
  Port      587
  Username  $SMTP_USER
  Password  $SMTP_PASS

  Sender    no-reply@$(terraform -chdir=infra output -raw site_url 2>/dev/null | sed 's|https://||')

This password is shown ONCE and is not recoverable — AWS returns the secret it
derives from exactly once, and nothing here stores either. If you lose it,
delete the key and run this again.

SES is in the sandbox until the production-access request is granted, so mail
sent with this will only reach verified addresses. Check with:

  aws sesv2 get-account --region $REGION \\
    --query '{production:ProductionAccessEnabled,review:Details.ReviewDetails}'
EOF
