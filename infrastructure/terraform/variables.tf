# infrastructure/terraform/variables.tf

variable "aws_region" {
  description = "AWS region (Cape Town)"
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod"
  }
}

variable "vpc_cidr_block" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]
}

# RDS Variables
variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
  # For production, use: db.r6g.xlarge or db.r6g.2xlarge for better performance
}

# EKS Variables
variable "eks_instance_type" {
  description = "EKS node instance type"
  type        = string
  default     = "t3.medium"
  # For production, use: m6i.xlarge or m6i.2xlarge
}

variable "eks_desired_size" {
  description = "EKS desired node group size"
  type        = number
  default     = 2
}

variable "eks_min_size" {
  description = "EKS minimum node group size"
  type        = number
  default     = 1
}

variable "eks_max_size" {
  description = "EKS maximum node group size"
  type        = number
  default     = 10
}

# CloudWatch Logs
variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7
}

# Redis
variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_clusters" {
  description = "Number of cache clusters in Redis"
  type        = number
  default     = 2
}

# Backup & Disaster Recovery
variable "backup_retention_days" {
  description = "Number of days to retain backups"
  type        = number
  default     = 30
}

# Tags
variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Team    = "Platform"
    Service = "Ahava"
  }
}
