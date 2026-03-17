# infrastructure/terraform/staging.tfvars
# Staging environment configuration

environment            = "staging"
vpc_cidr_block         = "10.1.0.0/16"
public_subnet_cidrs    = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
private_subnet_cidrs   = ["10.1.11.0/24", "10.1.12.0/24", "10.1.13.0/24"]

# RDS
rds_instance_class = "db.t4g.medium"

# EKS
eks_instance_type    = "t3.medium"
eks_desired_size     = 2
eks_min_size         = 2
eks_max_size         = 5

# Redis
redis_node_type            = "cache.t3.small"
redis_num_cache_clusters   = 2

# Retention
log_retention_days      = 7
backup_retention_days   = 14

tags = {
  Team        = "Platform"
  Service     = "Ahava"
  Environment = "staging"
}
