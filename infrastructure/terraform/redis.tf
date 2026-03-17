# infrastructure/terraform/redis.tf
# ElastiCache Redis for Ahava (BullMQ, cache, sessions)

resource "aws_elasticache_subnet_group" "main" {
  name       = "ahava-${var.environment}-redis-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "ahava-${var.environment}-redis-subnet-group"
  }
}

resource "aws_security_group" "redis" {
  name        = "ahava-${var.environment}-redis-sg"
  description = "Security group for Redis"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
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

resource "aws_elasticache_replication_group" "main" {
  replication_group_description = "Ahava Redis cluster for BullMQ and caching"
  engine                        = "redis"
  engine_version                = "7.1"
  node_type                     = var.redis_node_type
  num_cache_clusters            = var.redis_num_cache_clusters
  parameter_group_name          = aws_elasticache_parameter_group.main.name
  port                          = 6379
  subnet_group_name             = aws_elasticache_subnet_group.main.name
  security_group_ids            = [aws_security_group.redis.id]
  automatic_failover_enabled    = var.environment != "dev"
  multi_az_enabled              = var.environment == "prod"
  at_rest_encryption_enabled    = true
  transit_encryption_enabled    = true
  transit_encryption_mode       = "preferred"
  auth_token                    = random_password.redis.result
  apply_immediately             = var.environment == "dev"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
    enabled          = true
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_engine_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
    enabled          = true
  }

  tags = {
    Name = "ahava-${var.environment}-redis-cluster"
  }

  depends_on = [
    aws_cloudwatch_log_group.redis_slow_log,
    aws_cloudwatch_log_group.redis_engine_log,
  ]
}

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
output "redis_endpoint" {
  value = aws_elasticache_replication_group.main.configuration_endpoint_address
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}
