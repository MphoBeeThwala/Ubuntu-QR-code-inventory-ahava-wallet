# infrastructure/terraform/dev.tfvars
# Development environment configuration

environment            = "dev"
vpc_cidr_block         = "10.0.0.0/16"
public_subnet_cidrs    = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
private_subnet_cidrs   = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]

# RDS
rds_instance_class = "db.t4g.small"

# EKS
eks_instance_type    = "t3.small"
eks_desired_size     = 1
eks_min_size         = 1
eks_max_size         = 3

# Redis
redis_node_type            = "cache.t3.micro"
redis_num_cache_clusters   = 1

# Retention
log_retention_days      = 3
backup_retention_days   = 7

tags = {
  Team        = "Platform"
  Service     = "Ahava"
  Environment = "dev"
}
