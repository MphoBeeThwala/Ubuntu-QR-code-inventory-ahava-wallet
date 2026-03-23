# infrastructure/terraform/redis.tf
# ElastiCache Redis for Ahava (BullMQ, cache, sessions)

resource "aws_elasticache_subnet_group" "redis" {
  name       = "ahava-${var.environment}-redis-subnet"
  subnet_ids = local.private_subnets

  tags = {
    Name = "ahava-${var.environment}-redis-subnet-group"
  }
}

resource "aws_security_group" "redis" {
  name        = "ahava-${var.environment}-redis-sg"
  description = "Security group for Redis"
  vpc_id      = local.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [local.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ahava-${var.environment}-redis-sg"
  }
}

# aws_elasticache_replication_group is defined in main.tf as aws_elasticache_replication_group.redis
# to avoid duplicate resources. This file provides supporting resources only.

# Custom parameter group
resource "aws_elasticache_parameter_group" "main" {
  name        = "ahava-${var.environment}-redis-params"
  family      = "redis7"
  description = "Ahava Redis parameter group"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  parameter {
    name  = "timeout"
    value = "300"
  }

  tags = {
    Name = "ahava-${var.environment}-redis-params"
  }
}

# Redis auth token
resource "random_password" "redis" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "redis_auth_token" {
  name                    = "/ahava/${var.environment}/redis-auth-token"
  recovery_window_in_days = 7

  tags = {
    Name = "ahava-${var.environment}-redis-auth"
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth_token" {
  secret_id       = aws_secretsmanager_secret.redis_auth_token.id
  secret_string   = random_password.redis.result
}

# CloudWatch logs
resource "aws_cloudwatch_log_group" "redis_slow_log" {
  name              = "/aws/elasticache/ahava-${var.environment}-slow-log"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "ahava-${var.environment}-redis-slow-log"
  }
}

resource "aws_cloudwatch_log_group" "redis_engine_log" {
  name              = "/aws/elasticache/ahava-${var.environment}-engine-log"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "ahava-${var.environment}-redis-engine-log"
  }
}

# Outputs
output "redis_primary_endpoint_address" {
  description = "Redis primary endpoint (used by services for write operations)"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive   = true
}
