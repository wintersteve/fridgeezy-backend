#!/usr/bin/env bash
#
# Build the admin console and push it to the S3 bucket behind CloudFront.
#
#   ./infra/deploy-admin.sh
#
# Requires the admin resources to exist (`terraform -chdir=infra apply`) and
# AWS credentials that can write the bucket and invalidate the distribution.
#
# ## Where the three build-time values come from, and why none is committed
#
# Vite inlines `import.meta.env.VITE_*` at build time, so the bundle carries
# literals and a deployed console cannot be repointed without rebuilding. That
# makes "which values" a deploy-time question, and all three are read from the
# same places the rest of this repo already treats as authoritative:
#
#  - SUPABASE_URL / SUPABASE_ANON_KEY from `apps/api/.env.production`, which
#    `nx run @fridgeezy/database:env-remote` writes from SSM. Not read from
#    `.env.dev`, which points at a stack on somebody's laptop.
#  - The backend URL from `terraform output function_url`, the same
#    source-of-truth pattern deploy-site.sh uses for SITE_ORIGIN — so a
#    redeployed Lambda cannot leave the console talking to an old one.
#
# The anon key is PUBLIC by design and ends up in the bundle. That is the same
# key every copy of the mobile app ships; under RLS it can read the catalogue
# and nothing else, and every admin capability is behind `requireAdmin` on the
# API. See the header in infra/admin.tf.
#
# ## The two Cache-Control values are not interchangeable
#
#  - Assets are content-hashed by Vite, so a year is safe and correct: a
#    changed file is a different filename.
#  - `index.html` is `no-store`. It is the one object whose NAME stays the same
#    while its contents change, so a cached copy keeps pointing browsers at the
#    previous bundle's hashed filenames — which are still in the bucket, so
#    nothing errors and the deploy is simply invisible. The invalidation below
#    is the belt; this is the braces.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/apps/api/.env.production"

[ -f "$ENV_FILE" ] || {
    echo "No $ENV_FILE — run: npx nx run @fridgeezy/database:env-remote" >&2
    exit 1
}

read_env() {
    # The last assignment wins, matching how a shell would source the file, and
    # surrounding quotes are stripped — generate-env.ts does not write them but
    # a hand edit might.
    grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'
}

SUPABASE_URL="$(read_env SUPABASE_URL)"
SUPABASE_ANON_KEY="$(read_env SUPABASE_ANON_KEY)"

[ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ] || {
    echo "SUPABASE_URL or SUPABASE_ANON_KEY missing from $ENV_FILE" >&2
    exit 1
}

case "$SUPABASE_URL" in
    *127.0.0.1*|*localhost*)
        # Worth failing on rather than warning about: a console deployed
        # against a laptop's Supabase looks fine until the first request and
        # then cannot sign anybody in.
        echo "SUPABASE_URL in $ENV_FILE points at a local stack — run env-remote" >&2
        exit 1
        ;;
esac

BUCKET="$(terraform -chdir=infra output -raw admin_bucket_name)"
DIST_ID="$(terraform -chdir=infra output -raw admin_distribution_id)"
ADMIN_URL="$(terraform -chdir=infra output -raw admin_url)"
FUNCTION_URL="$(terraform -chdir=infra output -raw function_url)"

# The app appends bare paths to this, so it carries the /rest prefix and no
# trailing slash — the same contract `getBackendUrl()` has in the client.
BACKEND_URL="${FUNCTION_URL%/}/rest"

echo "==> building"
echo "    supabase: $SUPABASE_URL"
echo "    backend:  $BACKEND_URL"

VITE_SUPABASE_URL="$SUPABASE_URL" \
VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
VITE_BACKEND_URL="$BACKEND_URL" \
    npx nx run @fridgeezy/admin:build --skip-nx-cache

DIST="$ROOT/apps/admin/dist"

[ -f "$DIST/index.html" ] || {
    echo "build produced no index.html — refusing to sync" >&2
    exit 1
}

# Assets first, page last. In that order a browser that requests index.html
# mid-deploy is either served the old one (whose assets are still present) or
# the new one (whose assets have just landed) — never the new page pointing at
# files that are not there yet.
echo "==> syncing assets"
aws s3 sync "$DIST" "s3://$BUCKET" --delete \
    --exclude "index.html" \
    --cache-control "public, max-age=31536000, immutable"

echo "==> syncing index.html"
aws s3 cp "$DIST/index.html" "s3://$BUCKET/index.html" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "no-store" >/dev/null

echo "==> invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
    --paths "/*" --output text --query 'Invalidation.Id'

echo
echo "admin console deployed: $ADMIN_URL"
