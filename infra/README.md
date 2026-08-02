# infra — AWS (Terraform)

Infrastructure for running `apps/api` on AWS Lambda. Corresponds to **Phase 3**
of [`../TODOS.md`](../TODOS.md).

## This is additive — local development does not change

Nothing here replaces the local setup. `apps/api/src/main.ts` still boots Express
and listens on `PORT`, and the local workflow is untouched:

```bash
npm run api          # nx run api:serve — http://localhost:8000
```

The Lambda path is a second deployment target for the same app. The local
Express entry point is removed only after AWS is proven in prod — that teardown
is deliberately deferred, not forgotten.

## Status

The Terraform and the handler (`apps/api/src/lambda.ts`) are both in place. The
app serves `/rest` only — the MCP transport was removed before this merged, so
the session-state problem that used to block Lambda is gone rather than solved.

### How the handler works

`lambda.ts` binds the Express app to a loopback port once per execution
environment and proxies each invocation to it over a real HTTP request, piping
the response back into the Lambda response stream.

The loopback hop is deliberate. `express-app.ts` skips `express.json()` because
the handlers read the raw request stream themselves; a real socket satisfies that
for free, where a synthesised `IncomingMessage` would have to reproduce stream
semantics exactly. The cost is a localhost round trip with `TCP_NODELAY` set on
both ends.

Two consequences worth knowing:

- `context.callbackWaitsForEmptyEventLoop` is set to `false`. The loopback
  server stays bound between invocations, so the event loop is never empty and
  Lambda would otherwise wait for the full timeout on every request.
- Fire-and-forget image generation is registered in
  `apps/api/src/background-tasks.ts`, and the handler drains that registry after
  the response stream closes but before returning. Lambda freezes the
  environment on return, so an untracked promise could be suspended mid-upload.
  The client is not blocked by this; billed duration is.

If image generation starts dominating billed duration, the next step is to move
it to its own async invocation or an SQS consumer — the registry is the seam for
that.

### Verified locally

- Local server unchanged: `node dist/main.js` boots and serves `/rest/health`.
- Handler proxies status, headers, and body for 200 and 404 responses.
- SSE streams incrementally — chunks surface at the producer's cadence rather
  than arriving in one batch at the end.
- Drain: response reaches the client immediately, handler return is deferred
  until the tracked task settles.

Not yet verified against real AWS: cold-start latency, and Function URL
streaming behaviour end-to-end. Both need a deploy.

## Layout

| File | Contents |
|---|---|
| `versions.tf` | Terraform + provider constraints, state backend |
| `providers.tf` | AWS provider, default tags |
| `variables.tf` | All inputs |
| `main.tf` | Locals, artifact zipping |
| `lambda.tf` | Function, Function URL, log group |
| `iam.tf` | Execution role: logs, Bedrock, SSM |
| `ssm.tf` | Secret lookups (parameters created out-of-band) |
| `outputs.tf` | Function URL, ARNs, log group |
| `environments/*.tfvars` | Per-environment, non-secret config |

## Prerequisites

1. AWS credentials on the standard chain (`AWS_PROFILE`, SSO, or env vars).
2. Bedrock model access requested in the target region (Phase 0). Grant it to
   the `role_arn` output.
3. Secrets in SSM (below).

### Secrets

Terraform never holds these values in a file. Create them once per environment
under `/<project>/<environment>/`:

```bash
for KEY in OPENAI_API_KEY GOOGLE_API_KEY SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  aws ssm put-parameter \
    --name "/fridgeezy/dev/$KEY" \
    --type SecureString \
    --value "..." \
    --overwrite
done
```

**Do this before the first `terraform apply`.** `ssm.tf` reads these as `data`
sources, so Terraform will not create them — and a missing one fails at plan
time, before anything is provisioned:

```
Error: reading SSM Parameter (/fridgeezy/dev/OPENAI_API_KEY): couldn't find resource
```

All five must exist for the environment you are targeting. The error names the
parameter, so work through them until plan gets past the data lookups.

> **State sensitivity:** these values are read at apply time and injected as
> Lambda env vars, so they end up in Terraform state. That is why the S3 backend
> must be encrypted and access-controlled. The follow-up is to have the app read
> SSM at cold start instead — `iam.tf` already grants the permissions, so that
> change is app-side only.

### State backend

State is local right now so `terraform init` works with no bootstrap. Before a
second person applies, create the bucket and switch to the S3 backend block
commented in `versions.tf`:

```bash
aws s3api create-bucket --bucket fridgeezy-tfstate --region eu-central-1 \
  --create-bucket-configuration LocationConstraint=eu-central-1
aws s3api put-bucket-versioning --bucket fridgeezy-tfstate \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket fridgeezy-tfstate \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Terraform >= 1.10 locks via `use_lockfile`, so no DynamoDB table is needed.

## Build the artifact

Terraform zips `apps/api/dist` — it does not build it. Use the script:

```bash
./infra/build-artifact.sh
```

It runs the build, installs production dependencies into the output, repairs the
workspace links, and verifies the result. Do not run the two underlying commands
by hand: that sequence produced an artifact which booted perfectly locally and
died on Lambda, twice.

**Why it needs a script.** `@fridgeezy/api` bundles its own workspace libs but
keeps third-party packages external, so `node_modules` still has to be installed
into `dist/` — and `nx run api:prune` *recreates* `dist/`,
so doing it in the wrong order silently deletes the install. Then `npm ci` links
`@fridgeezy/*` according to the pruned lockfile, which resolves them to
repo-relative paths like `libs/schemas`; inside `dist/` that lands on
`dist/libs/schemas`, the compiled JS output, which has no `package.json`. The
symlink exists and points at something real, and is still unusable. `prune`
already stages correct copies under `dist/workspace_modules/`, so the script
swaps those in.

**Neither failure is visible locally.** Running `node apps/api/dist/main.js`
from inside the repo lets Node walk up past `dist/` and resolve `@fridgeezy/*`
from the repo's own `node_modules`. Lambda has no parent directory to walk up
to. To test an artifact honestly, copy it somewhere outside the repo and boot it
there — that reproduces the failure in seconds, without a deploy.

Both failure modes are now Terraform preconditions, so a bad artifact stops at
plan time instead of becoming a function that answers HTTP 200 with
`Runtime.ImportModuleError` in the body.

There are no native binaries in the artifact. `sharp` used to require a
cross-platform install step here (macOS produces darwin-arm64 binaries, which
fail on Lambda), but it was never actually imported and has been removed —
recipe images come from a `@google/genai` call and are uploaded straight to
Supabase storage. If a native dependency is ever added back, that step returns.

## Deploy

```bash
terraform init
terraform plan  -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars
```

Point clients at the `function_url` output.

## Why a Function URL and not API Gateway

Every endpoint in this app streams. API Gateway REST/HTTP APIs buffer the
response body, which breaks SSE. The Function URL is configured with
`invoke_mode = "RESPONSE_STREAM"`, which is the supported streaming path. Do not
put API Gateway in front of these endpoints.

## Not covered here yet

- CI/CD. Deploys are manual for now.
- Multi-region / HA — explicitly out of scope in `TODOS.md`.
