# ---------------------------------------------------------------------------
# Alerting
# ---------------------------------------------------------------------------
#
# Written after the 2026-08-21 outage, in which the OpenAI credit balance hit
# zero at 11:28 UTC, every AI path in the product stopped working, and nothing
# told us. It was found ~25 minutes later by opening the app.
#
# What made it invisible is worth stating, because it is what these alarms are
# shaped around: **the Lambda was completely healthy.** It reported 0 `Errors`
# and 0 `Throttles` for the entire outage, because the app caught the provider's
# 429, turned it into an SSE error frame, and returned 200. Alarming on Lambda's
# own metrics — the obvious thing to reach for — would have stayed green
# throughout.
#
# `GET /rest/health` was worse than useless: it answered in 3-5ms the whole
# time, because it touches no provider. A liveness check that cannot fail while
# the product is 100% broken is a green light over an outage.
#
# So the signal has to come from the application's own logs, which is what
# `classifyError` in @fridgeezy/streaming-server now emits: every failure
# handled by `createStreamHandler` writes one JSON object carrying a stable
# `code` and a `fault`.
#
# The `fault` axis is what decides whether a code gets an alarm at all, and it
# is deliberately not the same as "is it an error":
#
#   service  — we are broken or unpaid. It will not fix itself. PAGE.
#   upstream — a dependency is failing and may not be next minute. Rate-based.
#   client   — someone sent a bad body. Never alarmed on; it is a WARN in the
#              logs, and paging on it would train us to ignore the channel.

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

# Subscriptions are deliberately NOT managed here. An email subscription has to
# be confirmed by clicking a link in a mail, and Terraform cannot do that — it
# would create the resource, report success, and leave it `PendingConfirmation`
# forever, which is an alarm that silently goes nowhere. Subscribe once, by
# hand, and it persists across applies:
#
#   aws sns subscribe --topic-arn "$(terraform -chdir=infra output -raw alerts_topic_arn)" \
#     --protocol email --notification-endpoint you@example.com --region eu-central-1
#
# Then confirm the mail, and check it took — a subscription still showing
# `PendingConfirmation` is the failure mode to look for:
#
#   aws sns list-subscriptions-by-topic --topic-arn <arn> --region eu-central-1

# ---------------------------------------------------------------------------
# Metric filters
# ---------------------------------------------------------------------------
#
# ## Why these are substring patterns and not JSON ones
#
# The obvious pattern is `{ $.code = "provider_quota_exhausted" }`, and it does
# not work here. A CloudWatch JSON pattern requires the whole log EVENT to be
# valid JSON, and Lambda's Text log format prepends a timestamp, a request id
# and a level to every line — so the event is never valid JSON no matter how
# the app formats its message.
#
# The structured space-delimited form (`[prefix="[api]", w1, w2, json]`) fails
# for the same reason, and fails SILENTLY: it creates cleanly, matches nothing,
# and looks exactly like a healthy system. That was the first draft of this
# file. It was caught by `aws logs test-metric-filter` against a real log line,
# which is the only honest way to know a filter works — do that before trusting
# any change here:
#
#   aws logs test-metric-filter --filter-pattern '"provider_quota_exhausted"' \
#     --log-event-messages "$(a real line from the log group)" --region eu-central-1
#
# A bare quoted substring sidesteps the prefix entirely. It is coarser in
# principle and exact in practice: these code strings are emitted by exactly one
# line of code each, in `classifyError`, and appear nowhere else in any log.
#
# ## Why one filter per code rather than a `code` dimension
#
# `metric_transformation.dimensions = { code = "$.code" }` reads better and
# CloudWatch rejects it alongside `default_value`. Losing `default_value` means
# the metric publishes nothing at all while healthy, so `treat_missing_data`
# becomes the only thing standing between an idle dev function and a false
# alarm. One filter per alarmed code keeps the zero, and there are three.
#
# **The filter pattern and `error-handler.ts` have to change together.** If the
# emitted `code` strings are renamed, these go quiet, and quiet is what a
# healthy system looks like.

locals {
  metric_namespace = "Fridgeezy/${var.environment}"
}

# Out of money. The one that would have caught this morning.
resource "aws_cloudwatch_log_metric_filter" "provider_quota_exhausted" {
  name           = "${local.name_prefix}-provider-quota-exhausted"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "\"provider_quota_exhausted\""

  metric_transformation {
    name          = "ProviderQuotaExhausted"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

# Our key is being rejected — rotated without updating SSM, revoked, or scoped
# wrong. Split from the quota metric because the remedy is entirely different.
resource "aws_cloudwatch_log_metric_filter" "provider_auth_failed" {
  name           = "${local.name_prefix}-provider-auth-failed"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "\"provider_auth_failed\""

  metric_transformation {
    name          = "ProviderAuthFailed"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

# Unclassified server-side failures — a real bug, or a failure mode
# classifyError() has not learned to name yet.
resource "aws_cloudwatch_log_metric_filter" "internal_errors" {
  name           = "${local.name_prefix}-internal-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "\"internal_error\""

  metric_transformation {
    name          = "InternalErrors"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------
#
# `treat_missing_data = "notBreaching"` throughout: the `default_value = "0"`
# above only publishes a zero when the log group receives events at all, and an
# idle dev function has long stretches with none. "Missing" must not read as a
# fault, or the alarm cries wolf every quiet evening and gets muted — which is
# the same outcome as having no alarm, arrived at more slowly.

resource "aws_cloudwatch_metric_alarm" "provider_quota_exhausted" {
  alarm_name = "${local.name_prefix}-provider-quota-exhausted"

  alarm_description = <<-EOT
    The inference provider is refusing our requests for a reason that will not
    clear on its own — an exhausted credit balance.

    Every AI feature in the product is down. The Lambda will look healthy: it
    catches this and returns 200 with an error frame, so Errors and Throttles
    both stay at zero. Do not be reassured by them.

    Check the OpenAI billing page first, then:
      aws logs filter-log-events --log-group-name ${aws_cloudwatch_log_group.api.name} \
        --filter-pattern '"fault":"service"' --region ${var.aws_region}
  EOT

  namespace   = local.metric_namespace
  metric_name = aws_cloudwatch_log_metric_filter.provider_quota_exhausted.metric_transformation[0].name

  statistic = "Sum"
  period    = 60

  # One occurrence, once. The second tells us nothing the first did not, and
  # every minute spent confirming it is a minute of the product being down.
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  # Worth having on this one specifically: it is the alarm whose resolution is
  # a human action somewhere else entirely (paying a bill), so knowing it
  # cleared is genuinely useful information.
  ok_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "provider_auth_failed" {
  alarm_name = "${local.name_prefix}-provider-auth-failed"

  alarm_description = <<-EOT
    The inference provider is rejecting our credentials (401/403). Usually a key
    rotated without updating the SSM parameter under ${local.ssm_prefix}.

    Re-run infra/put-secrets.sh. loadSecrets() clears its memo on rejection, so
    the next request picks the new value up without a redeploy.
  EOT

  namespace   = local.metric_namespace
  metric_name = aws_cloudwatch_log_metric_filter.provider_auth_failed.metric_transformation[0].name

  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Rate-based, unlike the two above: one unhandled edge case is a ticket, a
# sustained stream of them is an incident.
resource "aws_cloudwatch_metric_alarm" "internal_errors" {
  alarm_name = "${local.name_prefix}-internal-errors"

  alarm_description = <<-EOT
    Unclassified server-side failures — not a provider problem. Either a genuine
    bug, or a failure mode classifyError() cannot name yet.

    If they are all the same error, teach classify-error.ts about it, so it gets
    its own code, its own alarm and its own remedy.
  EOT

  namespace   = local.metric_namespace
  metric_name = aws_cloudwatch_log_metric_filter.internal_errors.metric_transformation[0].name

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
}

# ---------------------------------------------------------------------------
# The Lambda's own health
# ---------------------------------------------------------------------------
#
# These would NOT have fired this morning. They are here for the failures that
# never reach application code at all, which is precisely the set the log-based
# alarms above are blind to: a cold-start crash on a missing SSM parameter, a
# bad artifact, an exhausted concurrency cap.

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name = "${local.name_prefix}-lambda-errors"

  alarm_description = <<-EOT
    The function itself is failing — a cold-start crash, a bad artifact, or an
    error escaping the Express app. Distinct from the log-based alarms: this
    fires for requests that never ran a line of our code.
  EOT

  namespace   = "AWS/Lambda"
  metric_name = "Errors"

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
}

# `lambda_reserved_concurrency = 5` in dev.tfvars makes this a realistic outcome
# of ordinary use rather than an abstract one — and a throttled request never
# reaches application code, so nothing log-based can see it.
resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name = "${local.name_prefix}-lambda-throttles"

  alarm_description = <<-EOT
    Concurrent executions hit the reserved cap (lambda_reserved_concurrency,
    currently ${var.lambda_reserved_concurrency == null ? "unset" : tostring(var.lambda_reserved_concurrency)}).
    Requests are being refused before our code runs, so no log-based alarm can
    see them.
  EOT

  namespace   = "AWS/Lambda"
  metric_name = "Throttles"

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
}
