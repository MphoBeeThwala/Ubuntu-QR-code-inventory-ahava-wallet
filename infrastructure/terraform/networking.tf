# infrastructure/terraform/networking.tf
# Local aliases bridging terraform-aws-modules/vpc outputs to the
# raw-resource references used throughout rds.tf / redis.tf / eks.tf.

locals {
  vpc_id           = module.vpc.vpc_id
  private_subnets  = module.vpc.private_subnets
  public_subnets   = module.vpc.public_subnets
  database_subnets = module.vpc.database_subnets
  vpc_cidr_block   = var.vpc_cidr_block
}
