# infrastructure/terraform/rds.tf
# RDS PostgreSQL 16 with TimescaleDB for Ahava

resource "aws_db_subnet_group" "main" {
  name       = "ahava-${var.environment}-db-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "ahava-${var.environment}-db-subnet-group"
  }
}

resource "aws_security_group" "rds" {
  name        = "ahava-${var.environment}-rds-sg"
  description = "Security group for RDS"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
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
    Name = "ahava-${var.environment}-rds-sg"
  }
}

resource "aws_rds_cluster" "main" {
  cluster_identifier              = "ahava-${var.environment}-db"
  engine                          = "aurora-postgresql"
  engine_version                  = "16.1"
  database_name                   = "ahava_db"
  master_username                 = "postgres"
  master_password                 = random_password.db_master.result
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.rds.id]
  backup_retention_period         = 30
  preferred_backup_window         = "03:00-04:00"
  skip_final_snapshot             = var.environment != "prod"
  final_snapshot_identifier       = var.environment == "prod" ? "ahava-prod-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}" : ""
  enable_cloudwatch_logs_exports  = ["postgresql"]
  enabled_cloudwatch_logs_exports = ["postgresql"]
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.rds.arn
  
  tags = {
    Name = "ahava-${var.environment}-aurora-cluster"
  }
}

resource "aws_rds_cluster_instance" "main" {
  count              = var.environment == "prod" ? 3 : 1
  identifier         = "ahava-${var.environment}-db-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = var.rds_instance_class
  engine              = aws_rds_cluster.main.engine
  engine_version      = aws_rds_cluster.main.engine_version

  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_monitoring.arn

  tags = {
    Name = "ahava-${var.environment}-db-instance-${count.index + 1}"
  }
}

# Database password (stored in Secrets Manager)
resource "random_password" "db_master" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "db_master_password" {
  name                    = "/ahava/${var.environment}/rds-master-password"
  recovery_window_in_days = 7

  tags = {
    Name = "ahava-${var.environment}-rds-password"
  }
}

resource "aws_secretsmanager_secret_version" "db_master_password" {
  secret_id       = aws_secretsmanager_secret.db_master_password.id
  secret_string   = random_password.db_master.result
}

# RDS Enhanced Monitoring IAM Role
resource "aws_iam_role" "rds_monitoring" {
  name = "ahava-${var.environment}-rds-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "monitoring.rds.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# KMS key for RDS encryption
resource "aws_kms_key" "rds" {
  description             = "KMS key for RDS encryption"
  deletion_window_in_days = 10
  enable_key_rotation     = true
}

resource "aws_kms_alias" "rds" {
  name          = "alias/ahava-${var.environment}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

# CloudWatch Alarms for RDS
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "ahava-${var.environment}-rds-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/Aurora"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "Alarm when RDS CPU exceeds 80%"
  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.main.cluster_identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "ahava-${var.environment}-rds-max-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/Aurora"
  period              = "300"
  statistic           = "Average"
  threshold           = "500"
  alarm_description   = "Alarm when RDS connections exceed 500"
  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.main.cluster_identifier
  }
}
