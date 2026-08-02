#!/usr/bin/env bash
#
# Build the Lambda artifact at apps/api/dist, ready for `terraform apply`.
#
#   ./infra/build-artifact.sh
#
# Replaces the two-command sequence the README used to give, because that
# sequence produced an artifact that booted fine locally and died on Lambda.
#
# Three things have to be true and only one of them is obvious:
#
#  1. dist/ has to be rebuilt BEFORE dependencies are installed into it —
#     `nx run api:prune` recreates the directory, so running it after `npm ci`
#     silently deletes node_modules.
#
#  2. Third-party dependencies have to be installed into dist/ at all. The app
#     bundles its own workspace libs but keeps npm packages external, so
#     express, cors and friends still have to be there.
#
#  3. The workspace packages (@fridgeezy/*) have to be REAL directories in
#     dist/node_modules, not symlinks. `npm ci` links them per the pruned
#     lockfile, which resolves them to repo-relative paths like `libs/schemas`;
#     inside dist/ that lands on compiled output with no package.json, so the
#     link exists, points somewhere real, and is unusable. Bundling means
#     nothing `require`s them at runtime any more, so this is now belt and
#     braces — kept because the pruned lockfile still declares them, and a
#     dangling link in a deployed artifact is not worth the saved seconds.
#
# Why this was not caught by running the app locally: booting from inside the
# repo lets Node walk up past dist/ and find the repo's own node_modules, which
# resolves @fridgeezy/* correctly. Lambda has no parent to walk up to. The
# verification at the end therefore checks resolution the way Lambda sees it,
# not the way the repo does.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/apps/api/dist"

cd "$ROOT"

echo "==> building (recreates dist/)"
npx nx run @fridgeezy/api:prune

echo "==> installing production dependencies into dist/"
npm ci --omit=dev --prefix "$DIST" >/dev/null

echo "==> replacing workspace symlinks with real packages"
if [ ! -d "$DIST/workspace_modules/@fridgeezy" ]; then
    echo "    workspace_modules/@fridgeezy missing — did prune succeed?" >&2
    exit 1
fi
rm -rf "$DIST/node_modules/@fridgeezy"
mkdir -p "$DIST/node_modules"
cp -R "$DIST/workspace_modules/@fridgeezy" "$DIST/node_modules/@fridgeezy"

echo "==> verifying the artifact resolves without the repo around it"
# Every workspace package must be a real directory with a package.json and a
# built entry point. A dangling or misdirected symlink passes a `-d` test, which
# is exactly how this shipped broken, so check for the manifest itself.
failed=0
for pkg in "$DIST"/node_modules/@fridgeezy/*; do
    name="@fridgeezy/$(basename "$pkg")"

    if [ -L "$pkg" ]; then
        echo "    $name is still a symlink" >&2
        failed=1
    elif [ ! -f "$pkg/package.json" ]; then
        echo "    $name has no package.json" >&2
        failed=1
    fi
done

# Third-party sanity check, matching the terraform precondition.
[ -f "$DIST/node_modules/express/package.json" ] || {
    echo "    express is missing — npm ci did not run" >&2
    failed=1
}

if [ "$failed" -ne 0 ]; then
    echo "artifact is NOT deployable" >&2
    exit 1
fi

# The check that matters most, because it is the one no amount of local running
# reproduces: load the handler from OUTSIDE the repo with require(esm) disabled.
#
# The app compiles to CommonJS while every lib is ESM. Node only allows
# require() of ESM from 22.12 onward, and AWS's nodejs22.x runtime is an earlier
# 22.x where it is still off — so a machine on 22.17 runs the artifact happily
# and Lambda dies with ERR_REQUIRE_ESM. Bundling the workspace libs is what
# actually fixes it; this is here to notice if that ever regresses.
#
# Env vars are stubbed because several libs throw at *import* on a missing key:
# this checks that modules load, not that config is valid.
echo "==> verifying the handler loads the way Lambda loads it"
probe="$(mktemp -d)"
trap 'rm -rf "$probe"' EXIT
(cd "$DIST" && tar cf - .) | (cd "$probe" && tar xf -)

if ! (cd "$probe" && \
    SUPABASE_URL=http://stub SUPABASE_ANON_KEY=stub SUPABASE_SERVICE_ROLE_KEY=stub \
    OPENAI_API_KEY=stub GOOGLE_API_KEY=stub \
    node --no-experimental-require-module -e "
        globalThis.awslambda = { streamifyResponse: (f) => f, HttpResponseStream: { from: (s) => s } };
        if (typeof require('./lambda.js').handler !== 'function') {
            throw new Error('lambda.js exports no handler');
        }
    " 2>&1); then
    echo "    handler does not load under Lambda's module semantics" >&2
    echo "    (outside the repo, with require(esm) disabled)" >&2
    exit 1
fi

count=$(find "$DIST/node_modules/@fridgeezy" -maxdepth 1 -mindepth 1 | wc -l | tr -d ' ')
echo
echo "artifact ready: $(du -sh "$DIST" | cut -f1), $count workspace packages, handler loads clean"
echo "next: terraform -chdir=infra apply -var-file=environments/dev.tfvars"
