# ---------------------------------------------------------------------------
# Cold starts
#
# Measured on `/rest/health`, the cheapest route in the app: 1.45s cold against
# 0.08s warm. That is the FLOOR — a cold chat turn additionally pays a paginated
# SSM fetch and the dynamic import of the whole module graph before it starts
# waiting on a model, and it lands on the first message of a session, which is
# the worst possible moment for it.
#
# Two levers, and they are not alternatives — they address different halves of
# the problem:
#
#   * The warmer below keeps ONE execution environment alive. It costs a few
#     cents a month and removes the cold start for the common case of a single
#     user picking the app up after an idle period.
#   * Provisioned concurrency (see `lambda_provisioned_concurrency` in
#     variables.tf) keeps N environments alive deterministically, and is the only
#     thing that helps when several people ask at once. It is off by default
#     because it is billed by the GB-second whether or not anyone calls.
#
# Start with the warmer. Reach for provisioned concurrency when the timing logs
# (`type = "turn_timing"`) show cold starts surviving it.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "warmer" {
  count = var.warmer_enabled ? 1 : 0

  name                = "${local.function_name}-warmer"
  description         = "Keeps one API execution environment warm; see warmer.tf."
  schedule_expression = var.warmer_schedule_expression
}

resource "aws_cloudwatch_event_target" "warmer" {
  count = var.warmer_enabled ? 1 : 0

  rule = aws_cloudwatch_event_rule.warmer[0].name
  arn  = aws_lambda_function.api.arn

  # A synthetic Function URL event, because that is the ONLY shape `lambda.ts`
  # knows how to proxy — it reads `requestContext.http.method` and `rawPath` and
  # replays them against the loopback Express server. A bare `{}` would throw
  # inside the handler, which would still warm the environment but would also
  # log an error every five minutes and pollute the failure alarms.
  #
  # `/rest/health` is deliberate on two counts: it is the one route that does not
  # require a Supabase token, and it exercises the real path — secrets loaded,
  # app imported, server bound — rather than short-circuiting before any of it.
  input = jsonencode({
    version = "2.0"
    rawPath = "/rest/health"
    headers = { "user-agent" = "fridgeezy-warmer" }
    requestContext = {
      http = {
        method = "GET"
        path   = "/rest/health"
      }
    }
    isBase64Encoded = false
  })
}

resource "aws_lambda_permission" "warmer" {
  count = var.warmer_enabled ? 1 : 0

  statement_id  = "AllowExecutionFromEventBridgeWarmer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.warmer[0].arn
}

# ---------------------------------------------------------------------------
# Provisioned concurrency (opt-in)
#
# Attached to an alias rather than to $LATEST, because Lambda refuses to
# provision an unpublished version — and an alias is what makes a deploy
# atomic for the provisioned environments as well as the on-demand ones.
# ---------------------------------------------------------------------------

resource "aws_lambda_alias" "live" {
  count = var.lambda_provisioned_concurrency == null ? 0 : 1

  name             = "live"
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}

resource "aws_lambda_provisioned_concurrency_config" "api" {
  count = var.lambda_provisioned_concurrency == null ? 0 : 1

  function_name                     = aws_lambda_function.api.function_name
  qualifier                         = aws_lambda_alias.live[0].name
  provisioned_concurrent_executions = var.lambda_provisioned_concurrency
}
