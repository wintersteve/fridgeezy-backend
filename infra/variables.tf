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
    compiled.

    Sits at the artifact root because the api project bundles: esbuild hoists
    every declared entry point, and `lambda.ts` is declared via
    `additionalEntryPoints`. It has to be declared explicitly — nothing reachable
    from `main.ts` imports it, so a bundled build would otherwise not emit it at
    all, and the function fails with `Cannot find module 'lambda'`.

    Was `apps/api/src/lambda.handler` while the project built unbundled, because
    esbuild then preserved workspace-relative paths for everything except `main`.
  EOT
  type        = string
  default     = "lambda.handler"
}

variable "lambda_runtime" {
  description = "Lambda Node.js runtime."
  type        = string
  default     = "nodejs22.x"
}

variable "lambda_architecture" {
  description = <<-EOT
    Instruction set for the function. arm64 is cheaper per GB-second and the
    artifact is pure JavaScript, so nothing constrains the choice — `sharp` used
    to, via its native binaries, but it was unused and has been removed. Adding
    any native dependency reintroduces the cross-platform install step.
  EOT
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.lambda_architecture)
    error_message = "lambda_architecture must be arm64 or x86_64."
  }
}

variable "lambda_memory_size" {
  description = <<-EOT
    Memory (MB). Also scales CPU.

    Was 2048, justified by local image processing with `sharp`. That dependency
    was unused and has been removed: images are produced by a @google/genai call
    and uploaded straight to Supabase storage, so nothing here is CPU-bound. The
    work is almost entirely waiting on a model over the network, and Lambda bills
    GB-seconds against that wall-clock time — on 15-30s streams, memory is the
    largest cost lever in this stack.

    1024 keeps cold starts comfortable for a Node runtime without paying for
    headroom nothing uses. This is a reasoned starting point, NOT a measurement:
    validate with AWS Lambda Power Tuning against a real recipe stream before
    treating it as settled, since the loopback proxy in lambda.ts and the JSONL
    accumulation do use some CPU.
  EOT
  type        = number
  default     = 1024
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

variable "llm_provider" {
  description = <<-EOT
    Which inference provider every call site resolves to (LLM_PROVIDER).

    Defaults to openai, matching resolveProvider() in @fridgeezy/llm — the whole
    point of the flag is that hosting can migrate without touching inference.
    Flip to bedrock only after the Phase 2 eval gate in TODOS.md.

    resolveProvider() throws on an unrecognised value rather than falling back,
    so a typo fails loudly instead of silently serving OpenAI; the validation
    below catches it at plan time instead.
  EOT
  type        = string
  default     = "openai"

  validation {
    condition     = contains(["openai", "bedrock"], var.llm_provider)
    error_message = "llm_provider must be openai or bedrock."
  }
}

variable "bedrock_model_id" {
  description = <<-EOT
    Value for BEDROCK_MODEL_ID. Unused while llm_provider is openai, but set so
    that flipping the provider is a one-variable change rather than a code
    deploy.

    Matches the default baked into @fridgeezy/bedrock's client. The `eu.` prefix
    is the cross-region inference profile for eu-central-1, the region TODOS.md
    settles on.
  EOT
  type        = string
  default     = "eu.anthropic.claude-sonnet-4-6"
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
