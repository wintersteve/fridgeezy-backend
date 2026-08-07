environment = "prod"
aws_region  = "eu-central-1"

lambda_timeout = 300

log_retention_days = 90

# NONE is the only workable value — see dev.tfvars for why AWS_IAM is not
# reachable from a published mobile binary. /rest is gated in the app by a
# Supabase access token; /health is not.
function_url_auth_type = "NONE"

# The paid gate. Stated explicitly rather than left to the variable default,
# because "false" is the dangerous value to arrive at by omission: prod running
# unenforced is free LLM spend for anyone who signs up. Prod has never been
# applied — when it first is, this should almost certainly already be true.
require_entitlement = false

# Spend ceiling and a guard on Supabase's connection pool. Enabled while the
# Function URL is still unauthenticated: uncapped, a leaked URL bills OpenAI and
# Gemini without limit. 50 was the figure picked when this was written; no
# representative load has been measured against it, so treat it as a ceiling to
# revise from real numbers rather than a sizing decision.
#
# Note this also RESERVES 50 from the account's concurrency pool, so it caps this
# function and withholds that capacity from any other function in the account.
lambda_reserved_concurrency = 50
