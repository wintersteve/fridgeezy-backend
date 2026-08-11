#!/usr/bin/env bash
#
# Build the static site and push it to the S3 bucket behind CloudFront.
#
#   ./infra/deploy-site.sh
#
# Requires the site resources to exist (`terraform -chdir=infra apply`) and AWS
# credentials that can write the bucket and invalidate the distribution.
#
# Two deliberate choices:
#
#  - The og origin is read from `terraform output` and passed into the build as
#    SITE_ORIGIN, the same source-of-truth pattern env-remote uses for the
#    Function URL. A plain `nx run @fridgeezy/site:build` therefore differs
#    from a deployed build in exactly one way: relative-only Open Graph URLs.
#
#  - Pages and assets sync with different Cache-Control. Asset filenames are
#    not content-hashed, so they get a day, not "immutable"; pages get five
#    minutes so a deploy is visible quickly even without the invalidation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUCKET="$(terraform -chdir=infra output -raw site_bucket_name)"
DIST_ID="$(terraform -chdir=infra output -raw site_distribution_id)"
SITE_ORIGIN="$(terraform -chdir=infra output -raw site_url)"

echo "==> building (og origin: $SITE_ORIGIN)"
SITE_ORIGIN="$SITE_ORIGIN" npx nx run @fridgeezy/site:build

DIST="$ROOT/apps/site/dist"

[ -f "$DIST/index.html" ] || {
    echo "build produced no index.html — refusing to sync" >&2
    exit 1
}

echo "==> syncing assets"
aws s3 sync "$DIST/assets" "s3://$BUCKET/assets" --delete \
    --cache-control "public, max-age=86400"

# The CLI guesses content types from extensions and misses woff2 on some
# systems, which makes browsers warn on every font load. Set it explicitly.
for font in "$DIST"/assets/fonts/*.woff2; do
    aws s3 cp "$font" "s3://$BUCKET/assets/fonts/$(basename "$font")" \
        --content-type font/woff2 \
        --cache-control "public, max-age=86400" >/dev/null
done

echo "==> syncing pages"
aws s3 sync "$DIST" "s3://$BUCKET" --delete --exclude "assets/*" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "public, max-age=300"

echo "==> invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
    --paths "/*" --output text --query 'Invalidation.Id'

echo
echo "site deployed: $SITE_ORIGIN"
