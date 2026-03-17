# infrastructure/terraform/main.tf
# Ahava eWallet — AWS Cape Town (af-south-1) Infrastructure
# All resources deployed in South Africa for POPIA data residency compliance

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }

  backend "s3" {
    bucket         = "ahava-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "af-south-1"
    encrypt        = true
    dynamodb_table = "ahava-terraform-locks"
  }
}

provider "aws" {
  region = "af-south-1"

  default_tags {
    tags = {
      Project     = "AhavaEWallet"
      Environment = var.environment
      ManagedBy   = "Terraform"
      DataClass   = "Financial-PII"
      Compliance  = "POPIA-FICA-SARB"
    }
  }
}

# ─────────────────────────────────────────────────────────────────
# VARIABLES
# ─────────────────────────────────────────────────────────────────

variable "environment" {
  type        = string
  description = "Deployment environment: staging | production"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be staging or production"
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

# ─────────────────────────────────────────────────────────────────
# VPC — Network isolation
# ─────────────────────────────────────────────────────────────────

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.5"

  name = "ahava-${var.environment}-vpc"
  cidr = var.vpc_cidr

  azs = ["af-south-1a", "af-south-1b", "af-south-1c"]

  # Public subnets — ALB only
  public_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]

  # Private subnets — EKS nodes, RDS, ElastiCache
  private_subnets  = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]

  # Database subnets — RDS only, no NAT
  database_subnets                   = ["10.0.21.0/24", "10.0.22.0/24", "10.0.23.0/24"]
  create_database_subnet_group       = true
  create_database_subnet_route_table = true

  enable_nat_gateway     = true
  single_nat_gateway     = var.environment == "staging"
  one_nat_gateway_per_az = var.environment == "production"

  enable_dns_hostnames = true
  enable_dns_support   = true

  # VPC Flow Logs — required for SARB security compliance
  enable_flow_log                      = true
  create_flow_log_cloudwatch_log_group = true
  create_flow_log_cloudwatch_iam_role  = true
  flow_log_max_aggregation_interval    = 60

  tags = {
    "kubernetes.io/cluster/ahava-${var.environment}" = "shared"
  }

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# ─────────────────────────────────────────────────────────────────
# RDS POSTGRESQL — Primary database with TimescaleDB
# ─────────────────────────────────────────────────────────────────

resource "aws_db_instance" "postgres" {
  identifier        = "ahava-${var.environment}-postgres"
  engine            = "postgres"
  engine_version    = "16.2"
  instance_class    = var.environment == "production" ? "db.r6g.xlarge" : "db.t3.medium"
  allocated_storage = var.environment == "production" ? 200 : 50
  max_allocated_storage = var.environment == "production" ? 1000 : 100

  db_name  = "ahava"
  username = "ahava_admin"
  password = data.aws_secretsmanager_secret_version.db_password.secret_string

  # Multi-AZ for production high availability
  multi_az = var.environment == "production"

  # Storage encryption (POPIA + SARB requirement)
  storage_encrypted = true
  kms_key_id        = aws_kms_key.ahava_data.arn
  storage_type      = "gp3"
  iops              = var.environment == "production" ? 3000 : null

  db_subnet_group_name   = module.vpc.database_subnet_group
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Backup — 5 year retention (FICA requirement)
  backup_retention_period   = 1825  # 5 years in days
  backup_window             = "02:00-04:00"  # SAST: 04:00-06:00 AM
  maintenance_window        = "sun:04:00-sun:06:00"
  delete_automated_backups  = false
  skip_final_snapshot       = false
  final_snapshot_identifier = "ahava-${var.environment}-final-${formatdate("YYYY-MM-DD", timestamp())}"

  # Performance insights
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  performance_insights_kms_key_id       = aws_kms_key.ahava_data.arn

  # Enhanced monitoring
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  # Disable public access — all access via private subnet only
  publicly_accessible = false

  # Auto minor version upgrade
  auto_minor_version_upgrade = true

  # Parameter group — optimised for financial workload
  parameter_group_name = aws_db_parameter_group.postgres.name

  # Deletion protection — ALWAYS on
  deletion_protection = true

  tags = {
    Name        = "ahava-${var.environment}-postgres"
    DataClass   = "Financial-PII-Encrypted"
    BackupYears = "5"
  }
}

resource "aws_db_parameter_group" "postgres" {
  name   = "ahava-${var.environment}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"  # Log queries > 1 second
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements,timescaledb"
  }

  parameter {
    name  = "max_connections"
    value = "500"
  }

  parameter {
    name         = "ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
}

# ─────────────────────────────────────────────────────────────────
# ELASTICACHE REDIS
# ─────────────────────────────────────────────────────────────────

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "ahava-${var.environment}-redis"
  description          = "Ahava eWallet Redis — sessions, queues, rate limiting, idempotency"

  node_type            = var.environment == "production" ? "cache.r6g.large" : "cache.t3.small"
  num_cache_clusters   = var.environment == "production" ? 3 : 1
  engine_version       = "7.2"
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  # Encryption in transit and at rest (POPIA)
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.ahava_data.arn

  # Auth token
  auth_token = data.aws_secretsmanager_secret_version.redis_auth_token.secret_string

  # Automatic failover for production
  automatic_failover_enabled = var.environment == "production"
  multi_az_enabled           = var.environment == "production"

  maintenance_window       = "sun:04:00-sun:06:00"
  snapshot_retention_limit = 7
  snapshot_window          = "02:00-04:00"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }
}

# ─────────────────────────────────────────────────────────────────
# S3 BUCKETS
# ─────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "kyc_documents" {
  bucket = "ahava-${var.environment}-kyc-documents"

  tags = {
    DataClass   = "PII-Sensitive-KYC"
    Compliance  = "POPIA-FICA"
    Retention   = "5-years-minimum"
  }
}

resource "aws_s3_bucket_versioning" "kyc_documents" {
  bucket = aws_s3_bucket.kyc_documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "kyc_documents" {
  bucket = aws_s3_bucket.kyc_documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.ahava_data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "kyc_documents" {
  bucket                  = aws_s3_bucket.kyc_documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "kyc_documents" {
  bucket = aws_s3_bucket.kyc_documents.id

  rule {
    id     = "kyc-document-retention"
    status = "Enabled"

    transition {
      days          = 365
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 1825  # 5 years — FICA minimum
      storage_class = "GLACIER_IR"
    }

    # Do NOT add expiration — KYC documents may be needed for regulatory audits
  }
}

resource "aws_s3_bucket" "audit_logs" {
  bucket = "ahava-${var.environment}-audit-logs"

  tags = {
    DataClass  = "Audit-Immutable"
    Compliance = "FICA-SARB"
    Retention  = "7-years-minimum"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    default_retention {
      mode = "COMPLIANCE"  # WORM — not even root can delete
      days = 2555           # 7 years
    }
  }
}

# ─────────────────────────────────────────────────────────────────
# KMS KEY — Data encryption
# ─────────────────────────────────────────────────────────────────

resource "aws_kms_key" "ahava_data" {
  description             = "Ahava eWallet data encryption key — RDS, S3, ElastiCache"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false  # Data residency: af-south-1 only

  tags = {
    Name      = "ahava-${var.environment}-data-key"
    DataClass = "Encryption-Key"
  }
}

resource "aws_kms_alias" "ahava_data" {
  name          = "alias/ahava-${var.environment}-data"
  target_key_id = aws_kms_key.ahava_data.key_id
}

# ─────────────────────────────────────────────────────────────────
# EKS CLUSTER
# ─────────────────────────────────────────────────────────────────

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = "ahava-${var.environment}"
  cluster_version = "1.29"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Control plane — public endpoint disabled (private only)
  cluster_endpoint_public_access  = false
  cluster_endpoint_private_access = true

  # Encryption
  cluster_encryption_config = {
    resources        = ["secrets"]
    provider_key_arn = aws_kms_key.ahava_data.arn
  }

  # Node groups
  eks_managed_node_groups = {
    services = {
      name           = "ahava-${var.environment}-services"
      instance_types = [var.environment == "production" ? "c6i.xlarge" : "c6i.large"]
      min_size       = var.environment == "production" ? 3 : 1
      max_size       = var.environment == "production" ? 20 : 5
      desired_size   = var.environment == "production" ? 3 : 2

      labels = {
        role = "services"
      }

      taints = []

      update_config = {
        max_unavailable_percentage = 25
      }
    }
  }

  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni    = { most_recent = true }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = aws_iam_role.ebs_csi.arn
    }
  }

  tags = {
    Name = "ahava-${var.environment}-eks"
  }
}

# ─────────────────────────────────────────────────────────────────
# WAF — Web Application Firewall (ALB)
# ─────────────────────────────────────────────────────────────────

resource "aws_wafv2_web_acl" "api" {
  name  = "ahava-${var.environment}-api-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # AWS Managed Rules — OWASP Top 10
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action { none {} }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # Rate limiting — 1000 req/5min per IP
  rule {
    name     = "RateLimitRule"
    priority = 2

    action { block {} }

    statement {
      rate_based_statement {
        limit              = 1000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitMetric"
      sampled_requests_enabled   = true
    }
  }

  # SQL injection protection
  rule {
    name     = "SQLiRule"
    priority = 3

    override_action { none {} }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLiRuleMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "AhavaAPIWAFMetric"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "ahava-${var.environment}-api-waf"
  }
}

# ─────────────────────────────────────────────────────────────────
# CLOUDWATCH ALARMS — Production monitoring
# ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "payment_error_rate" {
  alarm_name          = "ahava-${var.environment}-payment-error-rate"
  alarm_description   = "Payment service error rate > 1% — immediate investigation required"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "payment_errors_total"
  namespace           = "Ahava/PaymentService"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "api_latency_p99" {
  alarm_name          = "ahava-${var.environment}-api-latency-p99"
  alarm_description   = "API Gateway P99 latency > 2000ms"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 2
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "ahava-${var.environment}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

resource "aws_sns_topic" "alerts" {
  name              = "ahava-${var.environment}-engineering-alerts"
  kms_master_key_id = aws_kms_key.ahava_data.arn
}

# ─────────────────────────────────────────────────────────────────
# OUTPUTS
# ─────────────────────────────────────────────────────────────────

output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "rds_endpoint" {
  value     = aws_db_instance.postgres.endpoint
  sensitive = true
}

output "redis_primary_endpoint" {
  value     = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive = true
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "kyc_documents_bucket" {
  value = aws_s3_bucket.kyc_documents.bucket
}
