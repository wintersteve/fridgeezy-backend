environment = "prod"
aws_region  = "eu-central-1"

lambda_timeout = 300

log_retention_days = 90

# Public Function URL — the app carries no auth of its own yet.
function_url_auth_type = "NONE"

# Spend ceiling and a guard on Supabase's connection pool. Enabled while the
# Function URL is still unauthenticated: uncapped, a leaked URL bills OpenAI and
# Gemini without limit. 50 was the figure picked when this was written; no
# representative load has been measured against it, so treat it as a ceiling to
# revise from real numbers rather than a sizing decision.
#
# Note this also RESERVES 50 from the account's concurrency pool, so it caps this
# function and withholds that capacity from any other function in the account.
lambda_reserved_concurrency = 50
