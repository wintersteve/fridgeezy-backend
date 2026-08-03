environment = "dev"
aws_region  = "eu-central-1"

lambda_timeout = 300

log_retention_days = 14

# Public Function URL — the app carries no auth of its own yet.
function_url_auth_type = "NONE"

# Spend ceiling, not a capacity plan. The URL above is unauthenticated and every
# route behind it costs OpenAI/Gemini credits per request, so an uncapped
# function bills without limit if the URL leaks or a client retries in a loop.
# Dev has one developer and a phone on it — 5 is far above real use and still
# bounds the damage. Raise it when a real load figure exists, not before.
lambda_reserved_concurrency = 5
