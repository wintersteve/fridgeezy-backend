environment = "dev"
aws_region  = "eu-central-1"

lambda_timeout = 300

log_retention_days = 14

# NONE is the only workable value, not a gap left open. AWS_IAM would require
# the caller to SigV4-sign with real AWS credentials, which a published React
# Native binary cannot hold. The app authenticates instead: every /rest route
# demands a Supabase access token (`middleware/require-auth.ts`), /health does
# not. See TODOS.md, Phase 3.
function_url_auth_type = "NONE"

# The paid gate. Flip to true in the same release that ships the client purchase
# flow — not before, since with nothing able to grant an entitlement it 402s
# every request. See variables.tf for why this default is inverted relative to
# the auth gate, and delete the whole flag once purchasing is live.
require_entitlement = false

# Spend ceiling, not a capacity plan. The URL above is unauthenticated and every
# route behind it costs OpenAI/Gemini credits per request, so an uncapped
# function bills without limit if the URL leaks or a client retries in a loop.
# Dev has one developer and a phone on it — 5 is far above real use and still
# bounds the damage. Raise it when a real load figure exists, not before.
lambda_reserved_concurrency = 5
