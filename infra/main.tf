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

  # `@fridgeezy/api` builds unbundled, so the artifact is useless without its
  # dependencies installed into it — and the failure is silent: Terraform will
  # happily zip ~600KB of JavaScript, deploy it, and the function then dies at
  # cold start with `Cannot find module 'cors'` while the Function URL still
  # answers 200. Worse, `nx run api:build` *recreates* dist/, so running a build
  # after `npm ci` wipes node_modules and reintroduces this with no warning.
  #
  # Checking for express rather than the directory: an empty or half-installed
  # node_modules is the same failure and would pass a directory test.
  lifecycle {
    precondition {
      condition     = fileexists("${var.artifact_dir}/node_modules/express/package.json")
      error_message = "Artifact at ${var.artifact_dir} has no installed dependencies. Run:\n  npx nx run @fridgeezy/api:prune\n  npm ci --omit=dev --prefix apps/api/dist\nin that order — prune rebuilds dist/ and would wipe an earlier install."
    }
  }
}
