# infrastructure/terraform/eks.tf
# EKS supporting resources.
# The cluster, node groups, IAM roles, and security groups are fully managed
# by module "eks" (terraform-aws-modules/eks/aws ~> 20.8) in main.tf.
# The EBS CSI driver IRSA role is defined in iam.tf.

# ─────────────────────────────────────────────────────────────────
# EKS-OPTIMISED AMI — useful reference for custom launch templates
# ─────────────────────────────────────────────────────────────────

data "aws_ami" "eks_optimized" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amazon-eks-node-${module.eks.cluster_version}-v*"]
  }
}

# ─────────────────────────────────────────────────────────────────
# CLOUDWATCH LOG GROUP FOR EKS CONTROL PLANE
# (module creates it if enable_cluster_creator_admin_permissions is set,
#  but we declare it explicitly for lifecycle management)
# ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "eks_cluster" {
  name              = "/aws/eks/${module.eks.cluster_name}/cluster"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.ahava_data.arn

  tags = {
    Name = "ahava-${var.environment}-eks-logs"
  }
}

# ─────────────────────────────────────────────────────────────────
# OUTPUTS
# ─────────────────────────────────────────────────────────────────

output "eks_cluster_version" {
  value = module.eks.cluster_version
}

output "eks_node_ami_id" {
  description = "Latest EKS-optimised AMI ID for this cluster version"
  value       = data.aws_ami.eks_optimized.id
}
