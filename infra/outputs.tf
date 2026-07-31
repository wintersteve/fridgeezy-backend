output "function_name" {
  description = "Name of the API Lambda function."
  value       = aws_lambda_function.api.function_name
}

output "function_arn" {
  description = "ARN of the API Lambda function."
  value       = aws_lambda_function.api.arn
}

output "function_url" {
  description = "Streaming (SSE) base URL for the API. Point clients at this."
  value       = aws_lambda_function_url.api.function_url
}

output "role_arn" {
  description = "Execution role ARN — grant Bedrock model access to this principal."
  value       = aws_iam_role.api.arn
}

output "log_group_name" {
  description = "CloudWatch Logs group for the function."
  value       = aws_cloudwatch_log_group.api.name
}
