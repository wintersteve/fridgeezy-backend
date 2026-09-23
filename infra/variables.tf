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
    Instruction set for the function. arm64 is cheaper per GB-second.

    `sharp` is back (recipe images are re-encoded to WebP on upload), so this is
    load-bearing again: the artifact carries native binaries and they have to be
    the ones for THIS value. `infra/build-artifact.sh` reads it from
    `LAMBDA_ARCHITECTURE` (defaulting to arm64) and installs the matching
    linux/@img packages, then fails the build if they are missing. **Change this
    and the env var the build script reads together**, or the deploy succeeds and
    every recipe image throws inside a background task where nothing is waiting.
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

    Was 2048, justified by local image processing with `sharp`; dropped to 1024
    when that dependency was removed. `sharp` is back — recipe images are
    re-encoded to WebP and resized on upload — but it does NOT justify going back
    up: the two encodes measure ~70ms on an 864x1184 render and run in a
    background task, so they are noise against a model call. The work here is
    still almost entirely waiting on a model over the network, and Lambda bills
    GB-seconds against that wall-clock time — on 15-30s streams, memory is the
    largest cost lever in this stack.

    1024 kept cold starts comfortable without paying for headroom nothing uses,
    and said of itself that it was a reasoned starting point rather than a
    measurement. **It has now been measured, and it is 1769** (2026-09-22).

    1769 MB is where Lambda allocates ONE FULL vCPU; 1024 gets ~0.58 of one.
    That is what is being bought here — not memory. Across 5,558 production
    invocations the peak `maxMemoryUsed` was 270 MB and the average 165, so the
    function has never wanted more than a quarter of what it already has.

    What made CPU the suspect: `recipe.pairings` ran 17.7s for 411 output
    tokens — 41.5 ms/token, SEVEN TIMES the 5-6 ms/token every other streamed
    call managed in the same window — with a healthy 626 ms to first token, so
    the model started promptly and then delivered slowly. Nine other model calls
    completed INSIDE that stream's window, in the same invocation: the per-dish
    judging `generate-dish-pairings` dispatches without awaiting, precisely so
    the loop does not block. It does not block, but ten concurrent SSE streams
    being decoded, parsed and zod-validated on one Node thread at 0.58 vCPU
    compete, and the pairings reader is the one starved.

    The cost objection above still stands in principle — this bills GB-seconds
    against wall-clock, so 1.73x the memory is 1.73x the rate — and it does not
    bite yet: 3,143 seconds of billed compute over ten days is about four cents,
    so the experiment costs three. **Re-read that when traffic grows**, because
    at scale the trade inverts unless the duration falls with it.

    Validate the same way it was suspected: `firstTokenMs` against `latencyMs`
    per label (see `reportUsage`). If the streaming half of `recipe.pairings`
    does not tighten toward the others, the CPU theory is wrong and this goes
    back to 1024 — it is one variable and one in-place update either way.
  EOT
  type        = number
  default     = 1769
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
  default     = "gemini-3.1-flash-image"
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

# ---------------------------------------------------------------------------
# Cold-start mitigation. See warmer.tf for the reasoning and the measurements.
# ---------------------------------------------------------------------------

variable "warmer_enabled" {
  description = <<-EOT
    Whether to keep one execution environment alive with a scheduled ping.

    Cheap and effective for a single user returning to the app after an idle
    period, which is where the cold start actually lands. It does NOT help
    concurrent callers — each additional simultaneous request gets its own,
    cold, environment. That is what `lambda_provisioned_concurrency` is for.
  EOT
  type        = bool
  default     = true
}

variable "warmer_schedule_expression" {
  description = <<-EOT
    How often to ping. Lambda's idle reclaim is undocumented and variable, but
    environments are commonly reclaimed somewhere between five and fifteen
    minutes; five is comfortably inside that and costs roughly nine thousand
    invocations a month, which is free-tier noise.
  EOT
  type        = string
  default     = "rate(5 minutes)"
}

variable "lambda_provisioned_concurrency" {
  description = <<-EOT
    Number of execution environments to keep initialised, or null for none.

    Off by default because it bills by the GB-second whether or not anyone
    calls — unlike the warmer, which bills per invocation. Turn it on when the
    timing logs show cold starts surviving the warmer, which means concurrent
    traffic rather than idle reclaim.

    Setting this publishes a version and an alias; the Function URL still points
    at $LATEST, so raising this alone does not route traffic to the provisioned
    environments. Point the URL at the alias in the same change if that is what
    you want.
  EOT
  type        = number
  default     = null
}
