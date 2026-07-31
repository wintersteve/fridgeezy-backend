environment = "dev"
aws_region  = "eu-central-1"

lambda_memory_size = 2048
lambda_timeout     = 300

log_retention_days = 14

# Public Function URL — the app carries no auth of its own yet.
function_url_auth_type = "NONE"
