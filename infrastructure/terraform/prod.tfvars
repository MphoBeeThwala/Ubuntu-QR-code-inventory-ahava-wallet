# infrastructure/terraform/prod.tfvars
# Production environment configuration — SARB regulated

environment            = "prod"
vpc_cidr_block         = "10.2.0.0/16"
public_subnet_cidrs    = ["10.2.1.0/24", "10.2.2.0/24", "10.2.3.0/24"]
private_subnet_cidrs   = ["10.2.11.0/24", "10.2.12.0/24", "10.2.13.0/24"]

# RDS — High availability
rds_instance_class = "db.r6g.xlarge"

# EKS — HA
eks_instance_type    = "m6i.xlarge"
eks_desired_size     = 3
eks_min_size         = 3
eks_max_size         = 10

# Redis — High availability with failover
redis_node_type            = "cache.r6g.xlarge"
redis_num_cache_clusters   = 3

# Retention — FICA requires 5 years minimum
log_retention_days      = 365
backup_retention_days   = 1825  # 5 years

tags = {
  Team        = "Platform"
  Service     = "Ahava"
  Environment = "prod"
  Compliance  = "SARB-PSP"
  CostCenter  = "Payments"
}
