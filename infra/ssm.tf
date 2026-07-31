# These parameters are NOT created by Terraform — they hold secrets, and putting
# their values in a .tf file or .tfvars puts them in version control. Create them
# once per environment with `aws ssm put-parameter` (see README.md, "Secrets"),
# then Terraform reads the current value at apply time.
#
# NOTE: reading them here means the values land in Terraform state, which is why
# the state backend must be an encrypted, access-controlled S3 bucket. The
# Phase 3 follow-up is to have the app fetch these at cold start instead, so the
# values never leave SSM — the IAM permissions in iam.tf already allow it.

data "aws_ssm_parameter" "openai_api_key" {
  name = "${local.ssm_prefix}/OPENAI_API_KEY"
}

data "aws_ssm_parameter" "google_api_key" {
  name = "${local.ssm_prefix}/GOOGLE_API_KEY"
}

data "aws_ssm_parameter" "supabase_url" {
  name = "${local.ssm_prefix}/SUPABASE_URL"
}

data "aws_ssm_parameter" "supabase_anon_key" {
  name = "${local.ssm_prefix}/SUPABASE_ANON_KEY"
}

data "aws_ssm_parameter" "supabase_service_role_key" {
  name = "${local.ssm_prefix}/SUPABASE_SERVICE_ROLE_KEY"
}
