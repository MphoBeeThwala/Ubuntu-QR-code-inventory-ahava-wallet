# infrastructure/terraform/cloudwatch.tf
# CloudWatch log groups and metric alarms for all Ahava microservices.

# ─────────────────────────────────────────────────────────────────
# LOG GROUPS — one per service (structured JSON logs via Winston)
# ─────────────────────────────────────────────────────────────────

locals {
  services = toset([
    "api-gateway",
    "auth-service",
    "wallet-service",
    "payment-service",
    "kyc-service",
    "notification-service",
    "aml-service",
    "reporting-service",
    "ussd-service",
  ])
}

resource "aws_cloudwatch_log_group" "service" {
  for_each = local.services

  name              = "/ahava/${var.environment}/${each.value}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.ahava_data.arn

  tags = {
    Name    = "ahava-${var.environment}-${each.value}-logs"
    Service = each.value
  }
}

# ─────────────────────────────────────────────────────────────────
# PAYMENT SERVICE — critical metric filters
# ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_metric_filter" "payment_errors" {
  name           = "ahava-${var.environment}-payment-errors"
  log_group_name = aws_cloudwatch_log_group.service["payment-service"].name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name          = "PaymentErrors"
    namespace     = "Ahava/${var.environment}/PaymentService"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "payment_error_spike" {
  alarm_name          = "ahava-${var.environment}-payment-error-spike"
  alarm_description   = "Payment service error rate spike — investigate immediately"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "PaymentErrors"
  namespace           = "Ahava/${var.environment}/PaymentService"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# ─────────────────────────────────────────────────────────────────
# AML SERVICE — flag creation rate
# ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_metric_filter" "aml_critical_flags" {
  name           = "ahava-${var.environment}-aml-critical-flags"
  log_group_name = aws_cloudwatch_log_group.service["aml-service"].name
  pattern        = "{ $.severity = \"CRITICAL\" }"

  metric_transformation {
    name          = "AMLCriticalFlags"
    namespace     = "Ahava/${var.environment}/AMLService"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "aml_critical_spike" {
  alarm_name          = "ahava-${var.environment}-aml-critical-flag-spike"
  alarm_description   = "Unusual spike in CRITICAL AML flags — MLRO review required"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "AMLCriticalFlags"
  namespace           = "Ahava/${var.environment}/AMLService"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# ─────────────────────────────────────────────────────────────────
# AUTH SERVICE — failed login attempts (brute-force detection)
# ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_metric_filter" "auth_failures" {
  name           = "ahava-${var.environment}-auth-failures"
  log_group_name = aws_cloudwatch_log_group.service["auth-service"].name
  pattern        = "INVALID_PIN"

  metric_transformation {
    name          = "AuthFailures"
    namespace     = "Ahava/${var.environment}/AuthService"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "auth_failure_spike" {
  alarm_name          = "ahava-${var.environment}-auth-failure-spike"
  alarm_description   = "High rate of failed PIN attempts — possible brute-force attack"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "AuthFailures"
  namespace           = "Ahava/${var.environment}/AuthService"
  period              = 60
  statistic           = "Sum"
  threshold           = 50
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# ─────────────────────────────────────────────────────────────────
# ELB — 5xx error rate (API Gateway)
# ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "ahava-${var.environment}-alb-5xx-rate"
  alarm_description   = "ALB 5xx error rate above threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 20
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# ─────────────────────────────────────────────────────────────────
# REDIS — memory utilization
# ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "ahava-${var.environment}-redis-memory-high"
  alarm_description   = "Redis memory usage above 80% — risk of eviction"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# ─────────────────────────────────────────────────────────────────
# OUTPUTS
# ─────────────────────────────────────────────────────────────────

output "log_group_names" {
  description = "CloudWatch log group names per service"
  value       = { for k, v in aws_cloudwatch_log_group.service : k => v.name }
}
