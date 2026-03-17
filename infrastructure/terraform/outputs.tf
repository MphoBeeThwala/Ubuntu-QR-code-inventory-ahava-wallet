# infrastructure/terraform/outputs.tf

output "vpc_id" {
  value       = aws_vpc.main.id
  description = "VPC ID"
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "Public subnet IDs"
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet IDs"
}

output "rds_cluster_endpoint" {
  value       = aws_rds_cluster.main.endpoint
  description = "RDS cluster endpoint"
  sensitive   = true
}

output "rds_reader_endpoint" {
  value       = aws_rds_cluster.main.reader_endpoint
  description = "RDS reader endpoint"
  sensitive   = true
}

output "rds_database_name" {
  value       = aws_rds_cluster.main.database_name
  description = "RDS database name"
}

output "rds_master_username" {
  value       = aws_rds_cluster.main.master_username
  description = "RDS master username"
  sensitive   = true
}

output "eks_cluster_name" {
  value       = aws_eks_cluster.main.name
  description = "EKS cluster name"
}

output "eks_cluster_endpoint" {
  value       = aws_eks_cluster.main.endpoint
  description = "EKS cluster endpoint"
}

output "eks_cluster_arn" {
  value       = aws_eks_cluster.main.arn
  description = "EKS cluster ARN"
}

output "redis_endpoint" {
  value       = aws_elasticache_replication_group.main.configuration_endpoint_address
  description = "Redis cluster endpoint"
  sensitive   = true
}

output "ecr_registry_url" {
  value       = "${aws_ecr_repository.base["api-gateway"].registry_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
  description = "ECR registry URL"
}

output "kubeconfig_command" {
  value       = "aws eks update-kubeconfig --name ${aws_eks_cluster.main.name} --region ${var.aws_region}"
  description = "Command to update kubeconfig"
}

output "environment" {
  value       = var.environment
  description = "Environment name"
}
