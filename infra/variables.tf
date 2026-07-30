variable "aws_region" {
  description = <<-EOT
    Region to deploy into. Must serve the Bedrock models chosen in Phase 0 —
    confirm model availability before treating this default as final.
  EOT
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Deployment environment. Used in resource names and tags."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be one of: dev, prod."
  }
}

variable "project_name" {
  description = "Project slug used as the resource name prefix."
  type        = string
  default     = "fridgeezy"
}

# ---------------------------------------------------------------------------
# Lambda packaging
# ---------------------------------------------------------------------------

variable "artifact_dir" {
  description = <<-EOT
    Directory zipped and uploaded as the function code. Produced by
    `nx run @fridgeezy/api:prune` followed by an `npm ci --omit=dev` inside it.
    See README.md ("Build the artifact").
  EOT
  type        = string
  default     = "../apps/api/dist"
}

variable "lambda_handler" {
  description = <<-EOT
    Handler entry point, relative to the artifact root — `apps/api/src/lambda.ts`
    compiled. The path is nested because the api project builds unbundled and
    esbuild preserves workspace-relative paths; only the declared `main` entry is
    hoisted to the artifact root.
  EOT
  type        = string
  default     = "apps/api/src/lambda.handler"
}

variable "lambda_runtime" {
  description = "Lambda Node.js runtime."
  type        = string
  default     = "nodejs22.x"
}

variable "lambda_architecture" {
  description = <<-EOT
    Instruction set for the function. `sharp` ships native binaries, so the
    artifact must be installed for this architecture — see README.md ("sharp").
  EOT
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.lambda_architecture)
    error_message = "lambda_architecture must be arm64 or x86_64."
  }
}

variable "lambda_memory_size" {
  description = "Memory (MB). Also scales CPU, which matters for sharp image work."
  type        = number
  default     = 2048
}

variable "lambda_timeout" {
  description = <<-EOT
    Timeout (seconds). Needs headroom for the longest stream (recipe generation,
    ~15-30s of mostly model wait). Lambda's ceiling is 900.
  EOT
  type        = number
  default     = 300

  validation {
    condition     = var.lambda_timeout > 0 && var.lambda_timeout <= 900
    error_message = "lambda_timeout must be between 1 and 900 seconds."
  }
}

variable "lambda_reserved_concurrency" {
  description = "Reserved concurrent executions. null leaves the function unreserved."
  type        = number
  default     = null
}

# ---------------------------------------------------------------------------
# Function URL
# ---------------------------------------------------------------------------

variable "function_url_auth_type" {
  description = <<-EOT
    "NONE" makes the Function URL publicly invokable — that is what the current
    Express app assumes, since it has no auth of its own. Switch to "AWS_IAM"
    once the clients can sign requests.
  EOT
  type        = string
  default     = "NONE"

  validation {
    condition     = contains(["NONE", "AWS_IAM"], var.function_url_auth_type)
    error_message = "function_url_auth_type must be NONE or AWS_IAM."
  }
}

variable "function_url_cors_enabled" {
  description = <<-EOT
    Off by default: express-app.ts already applies the `cors` middleware, and
    configuring CORS in both places produces duplicate headers. Enable this only
    if CORS moves out of the app.
  EOT
  type        = bool
  default     = false
}

variable "function_url_cors_allow_origins" {
  description = "Allowed origins when function_url_cors_enabled is true."
  type        = list(string)
  default     = ["*"]
}

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------

variable "genai_image_model" {
  description = "Value for the GENAI_IMAGE_MODEL env var (recipe image generation)."
  type        = string
  default     = "gemini-2.5-flash-image"
}

variable "ssm_parameter_prefix" {
  description = <<-EOT
    Path prefix for the SecureString parameters holding the app's secrets. These
    are created out-of-band, not by Terraform — see README.md ("Secrets").
  EOT
  type        = string
  default     = null
}

variable "bedrock_model_arn_patterns" {
  description = <<-EOT
    Resource ARNs the function may invoke via Bedrock. Defaults cover foundation
    models in any region plus this account's inference profiles; tighten to the
    specific model IDs once Phase 0 picks them.
  EOT
  type        = list(string)
  default     = null
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the function's log group."
  type        = number
  default     = 30
}
