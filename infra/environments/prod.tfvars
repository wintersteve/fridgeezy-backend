environment = "prod"
aws_region  = "eu-central-1"

lambda_timeout = 300

log_retention_days = 90

# Public Function URL — the app carries no auth of its own yet.
function_url_auth_type = "NONE"

# Uncomment once representative load is known, to cap spend and protect Supabase.
# lambda_reserved_concurrency = 50
