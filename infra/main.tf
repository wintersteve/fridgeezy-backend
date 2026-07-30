data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  function_name = "${local.name_prefix}-api"

  ssm_prefix = coalesce(
    var.ssm_parameter_prefix,
    "/${var.project_name}/${var.environment}"
  )

  # Foundation models are region-agnostic in the ARN; inference profiles are
  # account- and region-scoped. Both are needed for cross-region inference.
  bedrock_model_arn_patterns = coalesce(var.bedrock_model_arn_patterns, [
    "arn:aws:bedrock:*::foundation-model/*",
    "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
  ])
}

# The artifact is built outside Terraform (see README.md). Zipping it here keeps
# `source_code_hash` honest, so an unchanged build is not redeployed.
data "archive_file" "api" {
  type        = "zip"
  source_dir  = var.artifact_dir
  output_path = "${path.module}/.terraform-artifacts/${local.function_name}.zip"

  # node_modules ships, but nothing that only matters on a developer machine.
  excludes = [
    ".env",
    ".env.local",
  ]
}
