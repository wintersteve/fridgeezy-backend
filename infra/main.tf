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

  # `@fridgeezy/api` bundles its own workspace libs but keeps third-party
  # packages external, so the artifact is useless without them installed into
  # it — and the failure is silent: Terraform will
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
      error_message = "Artifact at ${var.artifact_dir} has no third-party dependencies installed. Run ./infra/build-artifact.sh"
    }

    # Checked separately from express because the two fail for unrelated
    # reasons and only this one is invisible locally: `npm ci` links
    # @fridgeezy/* per the pruned lockfile, which resolves them to
    # repo-relative paths like `libs/schemas`. Inside dist/ that lands on the
    # compiled output, which has no package.json — so the symlink exists,
    # points at something real, and is still unusable on Lambda. Running the
    # app from inside the repo hides it entirely, because Node walks up and
    # finds the repo's own node_modules.
    precondition {
      condition     = fileexists("${var.artifact_dir}/node_modules/@fridgeezy/schemas/package.json")
      error_message = "Artifact at ${var.artifact_dir} has workspace packages that will not resolve on Lambda. Run ./infra/build-artifact.sh"
    }
  }
}
