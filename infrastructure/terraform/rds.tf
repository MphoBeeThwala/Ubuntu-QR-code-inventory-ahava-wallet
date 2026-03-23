# infrastructure/terraform/rds.tf
# Complementary RDS resources: security group, subnet group, IAM, KMS, CW alarms.
# The actual aws_db_instance is defined in main.tf to avoid duplicate resources.

# aws_db_subnet_group is created by the VPC module (create_database_subnet_group=true)
# and referenced in main.tf via module.vpc.database_subnet_group.

resource "aws_security_group" "rds" {
  name        = "ahava-${var.environment}-rds-sg"
  description = "Security group for RDS"
  vpc_id      = local.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
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
    Name = "ahava-${var.environment}-rds-sg"
  }
}

# RDS master password — also used by main.tf's aws_db_instance.postgres
resource "random_password" "db_master" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
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

# CloudWatch alarms for RDS CPU and connections are defined in main.tf
# to avoid duplicate resource names.
