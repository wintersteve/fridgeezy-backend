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

# Spend ceiling, not a capacity plan. The URL above is unauthenticated and every
# route behind it costs OpenAI/Gemini credits per request, so an uncapped
# function bills without limit if the URL leaks or a client retries in a loop.
# Dev has one developer and a phone on it — 5 is far above real use and still
# bounds the damage. Raise it when a real load figure exists, not before.
lambda_reserved_concurrency = 5

# fridgeezy.com, and it is in THIS file rather than prod.tfvars because of a
# naming accident worth knowing: there is one workspace and one state, it was
# applied from here, and so every live resource is named `fridgeezy-dev-*`. This
# stack is production — its Function URL is the one in the app's `.env` and its
# distribution serves d3psawhnc7yxi1.cloudfront.net. prod.tfvars has never been
# applied and would rename all of it.
#
# Only one environment may ever hold this value: a single nameserver set is
# delegated for the domain, so a second zone elsewhere would be created, charged
# for and silently ignored, and its certificate could never validate. See the
# header in dns.tf for the delegation step and the two-stage apply it needs.
site_domain = "fridgeezy.com"
