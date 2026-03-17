# infrastructure/terraform/ecr.tf
# ECR registries for Ahava services

# Base registry
resource "aws_ecr_repository" "base" {
  for_each = toset([
    "api-gateway",
    "auth-service",
    "wallet-service",
    "payment-service",
    "kyc-service",
    "notification-service",
    "reporting-service",
    "aml-service"
  ])

  name                 = "ahava-${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.ecr.arn
  }

  tags = {
    Name = "ahava-${var.environment}-${each.value}"
  }
}

# Lifecycle policy to clean up old images
resource "aws_ecr_lifecycle_policy" "main" {
  for_each   = aws_ecr_repository.base
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images, expire old ones"
        selection = {
          tagStatus     = "any"
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# KMS key for ECR encryption
resource "aws_kms_key" "ecr" {
  description             = "KMS key for ECR encryption"
  deletion_window_in_days = 10
  enable_key_rotation     = true
}

resource "aws_kms_alias" "ecr" {
  name          = "alias/ahava-${var.environment}-ecr"
  target_key_id = aws_kms_key.ecr.key_id
}

# Outputs
output "ecr_registry_id" {
  value = aws_ecr_repository.base["api-gateway"].registry_id
}

output "ecr_repository_urls" {
  value = {
    for k, v in aws_ecr_repository.base : k => v.repository_url
  }
}
