# infrastructure/terraform/iam.tf
# IAM roles and policies for EKS workloads via IRSA (IAM Roles for Service Accounts).
# IRSA allows pods to assume AWS roles without static credentials.

data "aws_caller_identity" "current" {}

# ─────────────────────────────────────────────────────────────────
# EBS CSI DRIVER — required by module.eks for persistent volumes
# ─────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ebs_csi_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    }

    principals {
      identifiers = [module.eks.oidc_provider_arn]
      type        = "Federated"
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "ahava-${var.environment}-ebs-csi-driver"
  assume_role_policy = data.aws_iam_policy_document.ebs_csi_assume.json

  tags = {
    Name = "ahava-${var.environment}-ebs-csi-role"
  }
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
  role       = aws_iam_role.ebs_csi.name
}

# ─────────────────────────────────────────────────────────────────
# SECRETS MANAGER ACCESS — shared by all services
# ─────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "secrets_read" {
  statement {
    sid     = "ReadAhavaSecrets"
    actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    effect  = "Allow"
    resources = [
      "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:/ahava/${var.environment}/*",
    ]
  }

  statement {
    sid     = "DecryptWithKMS"
    actions = ["kms:Decrypt", "kms:GenerateDataKey"]
    effect  = "Allow"
    resources = [aws_kms_key.ahava_data.arn]
  }
}

resource "aws_iam_policy" "secrets_read" {
  name        = "ahava-${var.environment}-secrets-read"
  description = "Allow reading Ahava application secrets from Secrets Manager"
  policy      = data.aws_iam_policy_document.secrets_read.json
}

# ─────────────────────────────────────────────────────────────────
# KYC SERVICE — S3 KYC document read/write
# ─────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "kyc_s3_access" {
  statement {
    sid    = "KYCDocumentReadWrite"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.kyc_documents.arn,
      "${aws_s3_bucket.kyc_documents.arn}/*",
    ]
  }

  statement {
    sid       = "KYCKMSAccess"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.ahava_data.arn]
  }
}

resource "aws_iam_policy" "kyc_s3_access" {
  name        = "ahava-${var.environment}-kyc-s3-access"
  description = "KYC service: read/write KYC documents in S3"
  policy      = data.aws_iam_policy_document.kyc_s3_access.json
}

# KYC service account IRSA role
data "aws_iam_policy_document" "kyc_service_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:ahava:kyc-service"]
    }

    principals {
      identifiers = [module.eks.oidc_provider_arn]
      type        = "Federated"
    }
  }
}

resource "aws_iam_role" "kyc_service" {
  name               = "ahava-${var.environment}-kyc-service"
  assume_role_policy = data.aws_iam_policy_document.kyc_service_assume.json
  tags               = { Name = "ahava-${var.environment}-kyc-service-role" }
}

resource "aws_iam_role_policy_attachment" "kyc_s3" {
  role       = aws_iam_role.kyc_service.name
  policy_arn = aws_iam_policy.kyc_s3_access.arn
}

resource "aws_iam_role_policy_attachment" "kyc_secrets" {
  role       = aws_iam_role.kyc_service.name
  policy_arn = aws_iam_policy.secrets_read.arn
}

# ─────────────────────────────────────────────────────────────────
# REPORTING SERVICE — S3 audit log read + CloudWatch PutMetricData
# ─────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "reporting_service_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:ahava:reporting-service"]
    }

    principals {
      identifiers = [module.eks.oidc_provider_arn]
      type        = "Federated"
    }
  }
}

resource "aws_iam_role" "reporting_service" {
  name               = "ahava-${var.environment}-reporting-service"
  assume_role_policy = data.aws_iam_policy_document.reporting_service_assume.json
  tags               = { Name = "ahava-${var.environment}-reporting-service-role" }
}

resource "aws_iam_role_policy_attachment" "reporting_secrets" {
  role       = aws_iam_role.reporting_service.name
  policy_arn = aws_iam_policy.secrets_read.arn
}

# ─────────────────────────────────────────────────────────────────
# ALL OTHER SERVICES — secrets read only
# ─────────────────────────────────────────────────────────────────

locals {
  service_accounts = toset([
    "auth-service",
    "wallet-service",
    "payment-service",
    "aml-service",
    "notification-service",
    "api-gateway",
  ])
}

data "aws_iam_policy_document" "service_assume" {
  for_each = local.service_accounts

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:ahava:${each.key}"]
    }

    principals {
      identifiers = [module.eks.oidc_provider_arn]
      type        = "Federated"
    }
  }
}

resource "aws_iam_role" "service_irsa" {
  for_each = local.service_accounts

  name               = "ahava-${var.environment}-${each.value}"
  assume_role_policy = data.aws_iam_policy_document.service_assume[each.value].json
  tags               = { Name = "ahava-${var.environment}-${each.value}-irsa" }
}

resource "aws_iam_role_policy_attachment" "service_secrets" {
  for_each = local.service_accounts

  role       = aws_iam_role.service_irsa[each.value].name
  policy_arn = aws_iam_policy.secrets_read.arn
}

# ─────────────────────────────────────────────────────────────────
# OUTPUTS
# ─────────────────────────────────────────────────────────────────

output "kyc_service_role_arn" {
  value = aws_iam_role.kyc_service.arn
}

output "service_irsa_arns" {
  description = "IRSA role ARNs keyed by service name (annotate k8s ServiceAccounts with these)"
  value       = { for k, v in aws_iam_role.service_irsa : k => v.arn }
}
