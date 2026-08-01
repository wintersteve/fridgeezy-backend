resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name = local.function_name
  role          = aws_iam_role.api.arn

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  handler       = var.lambda_handler
  runtime       = var.lambda_runtime
  architectures = [var.lambda_architecture]

  memory_size = var.lambda_memory_size
  timeout     = var.lambda_timeout

  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      NODE_ENV = "production"

      GENAI_IMAGE_MODEL = var.genai_image_model

      # Inference provider selection. Defaults to openai, so deploying to Lambda
      # changes hosting only — the model swap is a separate, gated phase.
      LLM_PROVIDER     = var.llm_provider
      BEDROCK_MODEL_ID = var.bedrock_model_id

      OPENAI_API_KEY = data.aws_ssm_parameter.openai_api_key.value
      GOOGLE_API_KEY = data.aws_ssm_parameter.google_api_key.value

      SUPABASE_URL              = data.aws_ssm_parameter.supabase_url.value
      SUPABASE_ANON_KEY         = data.aws_ssm_parameter.supabase_anon_key.value
      SUPABASE_SERVICE_ROLE_KEY = data.aws_ssm_parameter.supabase_service_role_key.value

      # PORT is deliberately absent — nothing listens on a socket in Lambda.
      # AWS_REGION is reserved and injected by the runtime; Bedrock picks it up.
    }
  }

  depends_on = [
    aws_iam_role_policy.api,
    aws_cloudwatch_log_group.api,
  ]
}

# Every endpoint in this app streams (SSE). API Gateway buffers responses and
# breaks SSE, so the function is fronted by a Function URL in RESPONSE_STREAM
# invoke mode instead. Do not put API Gateway in front of this.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = var.function_url_auth_type
  invoke_mode        = "RESPONSE_STREAM"

  dynamic "cors" {
    for_each = var.function_url_cors_enabled ? [1] : []

    content {
      allow_origins = var.function_url_cors_allow_origins
      allow_methods = ["GET", "POST", "OPTIONS"]
      # `mcp-session-id` was dropped with the MCP transport — the app serves
      # /rest only, and nothing sends that header any more.
      allow_headers = ["content-type"]
      max_age       = 86400
    }
  }
}
