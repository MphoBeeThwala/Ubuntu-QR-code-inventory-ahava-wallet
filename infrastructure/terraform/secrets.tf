# infrastructure/terraform/secrets.tf
# AWS Secrets Manager entries for all application secrets.
# Secret VALUES are managed outside Terraform (injected via CI/CD or manually).
# Terraform only creates the secret containers + stores generated passwords.

# ─────────────────────────────────────────────────────────────────
# JWT RS256 KEYS
# ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "jwt_private_key" {
  name                    = "/ahava/${var.environment}/jwt-private-key"
  description             = "RS256 JWT signing private key (PEM format)"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name      = "ahava-${var.environment}-jwt-private-key"
    DataClass = "Cryptographic-Key"
  }
}

resource "aws_secretsmanager_secret" "jwt_public_key" {
  name                    = "/ahava/${var.environment}/jwt-public-key"
  description             = "RS256 JWT verification public key (PEM format)"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name      = "ahava-${var.environment}-jwt-public-key"
    DataClass = "Cryptographic-Key"
  }
}

# ─────────────────────────────────────────────────────────────────
# PII ENCRYPTION
# ─────────────────────────────────────────────────────────────────

resource "random_bytes" "pii_encryption_key" {
  length = 32
}

resource "aws_secretsmanager_secret" "pii_encryption_key" {
  name                    = "/ahava/${var.environment}/pii-encryption-key"
  description             = "AES-256-GCM key for PII field encryption (hex encoded, 32 bytes)"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name      = "ahava-${var.environment}-pii-key"
    DataClass = "Encryption-Key"
  }
}

resource "aws_secretsmanager_secret_version" "pii_encryption_key" {
  secret_id     = aws_secretsmanager_secret.pii_encryption_key.id
  secret_string = random_bytes.pii_encryption_key.hex
}

resource "random_password" "hash_salt" {
  length           = 32
  special          = false
}

resource "aws_secretsmanager_secret" "hash_salt" {
  name                    = "/ahava/${var.environment}/hash-salt"
  description             = "SHA-256 lookup hash salt for PII field indexing"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name      = "ahava-${var.environment}-hash-salt"
    DataClass = "Cryptographic-Key"
  }
}

resource "aws_secretsmanager_secret_version" "hash_salt" {
  secret_id     = aws_secretsmanager_secret.hash_salt.id
  secret_string = random_password.hash_salt.result
}

# ─────────────────────────────────────────────────────────────────
# PAYSHAP / SARB mTLS CERTIFICATE
# ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "payshap_mtls_cert" {
  name                    = "/ahava/${var.environment}/payshap-mtls-cert"
  description             = "PayShap mTLS client certificate (PEM) — provided by SARB/PayShap onboarding"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name       = "ahava-${var.environment}-payshap-cert"
    DataClass  = "Cryptographic-Key"
    Compliance = "SARB-PSP"
  }
}

resource "aws_secretsmanager_secret" "payshap_mtls_key" {
  name                    = "/ahava/${var.environment}/payshap-mtls-key"
  description             = "PayShap mTLS client private key (PEM) — provided by SARB/PayShap onboarding"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name       = "ahava-${var.environment}-payshap-key"
    DataClass  = "Cryptographic-Key"
    Compliance = "SARB-PSP"
  }
}

# ─────────────────────────────────────────────────────────────────
# COMPLY ADVANTAGE (AML SCREENING)
# ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "comply_advantage_api_key" {
  name                    = "/ahava/${var.environment}/comply-advantage-api-key"
  description             = "ComplyAdvantage API key for AML/sanctions screening"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name       = "ahava-${var.environment}-comply-advantage-key"
    DataClass  = "API-Credential"
    Compliance = "AML-FICA"
  }
}

# ─────────────────────────────────────────────────────────────────
# AFRICA'S TALKING (SMS / USSD)
# ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "africas_talking" {
  name                    = "/ahava/${var.environment}/africas-talking"
  description             = "Africa's Talking API key and username (JSON object)"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name      = "ahava-${var.environment}-africas-talking"
    DataClass = "API-Credential"
  }
}

# ─────────────────────────────────────────────────────────────────
# FIREBASE CLOUD MESSAGING
# ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "fcm_server_key" {
  name                    = "/ahava/${var.environment}/fcm-server-key"
  description             = "Firebase Cloud Messaging server key for push notifications"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.ahava_data.arn

  tags = {
    Name      = "ahava-${var.environment}-fcm-key"
    DataClass = "API-Credential"
  }
}

# ─────────────────────────────────────────────────────────────────
# SENTRY DSN
# ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "sentry_dsn" {
  name                    = "/ahava/${var.environment}/sentry-dsn"
  description             = "Sentry DSN for error tracking across all services"
  recovery_window_in_days = 7

  tags = {
    Name      = "ahava-${var.environment}-sentry-dsn"
    DataClass = "API-Credential"
  }
}

# ─────────────────────────────────────────────────────────────────
# DATADOG API KEY
# ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "datadog_api_key" {
  name                    = "/ahava/${var.environment}/datadog-api-key"
  description             = "Datadog API key for APM/metrics/logs ingestion"
  recovery_window_in_days = 7

  tags = {
    Name      = "ahava-${var.environment}-datadog-api-key"
    DataClass = "API-Credential"
  }
}

# ─────────────────────────────────────────────────────────────────
# OUTPUTS
# ─────────────────────────────────────────────────────────────────

output "secret_arns" {
  description = "ARNs of all Secrets Manager secrets (for IAM policy construction)"
  sensitive   = true
  value = {
    jwt_private_key        = aws_secretsmanager_secret.jwt_private_key.arn
    jwt_public_key         = aws_secretsmanager_secret.jwt_public_key.arn
    pii_encryption_key     = aws_secretsmanager_secret.pii_encryption_key.arn
    hash_salt              = aws_secretsmanager_secret.hash_salt.arn
    payshap_mtls_cert      = aws_secretsmanager_secret.payshap_mtls_cert.arn
    payshap_mtls_key       = aws_secretsmanager_secret.payshap_mtls_key.arn
    comply_advantage       = aws_secretsmanager_secret.comply_advantage_api_key.arn
    africas_talking        = aws_secretsmanager_secret.africas_talking.arn
    fcm_server_key         = aws_secretsmanager_secret.fcm_server_key.arn
    sentry_dsn             = aws_secretsmanager_secret.sentry_dsn.arn
    datadog_api_key        = aws_secretsmanager_secret.datadog_api_key.arn
    db_master_password     = aws_secretsmanager_secret.db_master_password.arn
    redis_auth_token       = aws_secretsmanager_secret.redis_auth_token.arn
  }
}
