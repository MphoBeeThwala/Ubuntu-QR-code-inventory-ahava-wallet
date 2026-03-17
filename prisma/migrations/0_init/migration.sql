-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- CreateEnum
CREATE TYPE "public"."KycTier" AS ENUM ('TIER_0', 'TIER_1', 'TIER_2', 'MERCHANT');

-- CreateEnum
CREATE TYPE "public"."KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."WalletType" AS ENUM ('PERSONAL', 'YOUTH', 'MERCHANT', 'AGENT', 'ESCROW', 'FEE_POOL');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('CREDIT', 'DEBIT', 'FEE', 'REFUND', 'REVERSAL', 'INTEREST', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('UBUNTUPAY_WALLET', 'PAYSHAP', 'CASH_IN', 'CASH_OUT');

-- CreateEnum
CREATE TYPE "public"."QrCodeType" AS ENUM ('STATIC', 'DYNAMIC', 'REQUEST');

-- CreateEnum
CREATE TYPE "public"."AmlFlagSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."AmlFlagStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'DISMISSED', 'ESCALATED', 'STR_FILED');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('SA_ID_BOOK', 'SA_ID_CARD', 'PASSPORT', 'ASYLUM_DOCUMENT', 'REFUGEE_DOCUMENT', 'PROOF_OF_ADDRESS', 'PROOF_OF_INCOME', 'BUSINESS_REGISTRATION', 'SELFIE');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('PUSH', 'SMS', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "public"."AgentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TRAINING', 'TERMINATED');

-- CreateTable "users"
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phoneNumber" VARCHAR(20) NOT NULL,
    "phoneNumberHash" VARCHAR(64) NOT NULL,
    "email" VARCHAR(255),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "fullName" VARCHAR(200),
    "preferredName" VARCHAR(100),
    "dateOfBirth" DATE,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "guardianUserId" UUID,
    "kycTier" "public"."KycTier" NOT NULL DEFAULT 'TIER_0',
    "kycStatus" "public"."KycStatus" NOT NULL DEFAULT 'PENDING',
    "idNumber" VARCHAR(13),
    "idNumberHash" VARCHAR(64),
    "idType" "public"."DocumentType",
    "idVerifiedAt" TIMESTAMP(3),
    "idVerificationRef" VARCHAR(100),
    "facialBiometricHash" VARCHAR(256),
    "biometricEnrolledAt" TIMESTAMP(3),
    "primaryDeviceId" VARCHAR(200),
    "deviceBoundAt" TIMESTAMP(3),
    "pinHash" VARCHAR(256),
    "pinChangedAt" TIMESTAMP(3),
    "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "biometricEnabled" BOOLEAN NOT NULL DEFAULT false,
    "preferredLanguage" VARCHAR(5) NOT NULL DEFAULT 'en',
    "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
    "smsNotifications" BOOLEAN NOT NULL DEFAULT true,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "sanctionsScreenedAt" TIMESTAMP(3),
    "sanctionsResult" VARCHAR(20),
    "pepFlag" BOOLEAN NOT NULL DEFAULT false,
    "popiConsentAt" TIMESTAMP(3),
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersion" VARCHAR(10),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable "refresh_tokens"
CREATE TABLE "public"."refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "deviceId" VARCHAR(200) NOT NULL,
    "deviceName" VARCHAR(200),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable "kyc_documents"
CREATE TABLE "public"."kyc_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "documentType" "public"."DocumentType" NOT NULL,
    "s3Key" VARCHAR(500) NOT NULL,
    "documentHash" VARCHAR(64) NOT NULL,
    "verificationStatus" "public"."KycStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedBy" UUID,
    "verifiedAt" TIMESTAMP(3),
    "rejectedReason" VARCHAR(500),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable "wallets"
CREATE TABLE "public"."wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "walletNumber" VARCHAR(20) NOT NULL,
    "walletType" "public"."WalletType" NOT NULL DEFAULT 'PERSONAL',
    "status" "public"."WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "kycTier" "public"."KycTier" NOT NULL DEFAULT 'TIER_0',
    "balance" BIGINT NOT NULL DEFAULT 0,
    "pendingBalance" BIGINT NOT NULL DEFAULT 0,
    "reservedBalance" BIGINT NOT NULL DEFAULT 0,
    "dailyLimit" BIGINT NOT NULL DEFAULT 50000,
    "monthlyLimit" BIGINT NOT NULL DEFAULT 200000,
    "maxBalance" BIGINT NOT NULL DEFAULT 250000,
    "perTransactionLimit" BIGINT NOT NULL DEFAULT 50000,
    "dailySpent" BIGINT NOT NULL DEFAULT 0,
    "monthlySpent" BIGINT NOT NULL DEFAULT 0,
    "dailyReceived" BIGINT NOT NULL DEFAULT 0,
    "lastDailyReset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMonthlyReset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    "floatInterestRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "lastInterestCreditAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" VARCHAR(500),
    "frozenAt" TIMESTAMP(3),
    "frozenReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable "wallet_transactions"
CREATE TABLE "public"."wallet_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "transactionType" "public"."TransactionType" NOT NULL,
    "status" "public"."TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "public"."PaymentMethod" NOT NULL,
    "amount" BIGINT NOT NULL,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "netAmount" BIGINT NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "counterpartyWalletId" UUID,
    "counterpartyName" VARCHAR(200),
    "counterpartyRef" VARCHAR(100),
    "paymentQrId" UUID,
    "idempotencyKey" VARCHAR(36) NOT NULL,
    "description" VARCHAR(500),
    "reference" VARCHAR(200),
    "internalNote" VARCHAR(1000),
    "payshapRef" VARCHAR(100),
    "payshapStatus" VARCHAR(50),
    "externalRef" VARCHAR(200),
    "deviceId" VARCHAR(200),
    "ipAddress" VARCHAR(45),
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "amlScreened" BOOLEAN NOT NULL DEFAULT false,
    "amlScreenedAt" TIMESTAMP(3),
    "amlRiskScore" INTEGER,
    "amlFlagId" UUID,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" VARCHAR(500),
    "originalTransactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable "payment_qr_codes"
CREATE TABLE "public"."payment_qr_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "qrType" "public"."QrCodeType" NOT NULL,
    "qrPayload" TEXT NOT NULL,
    "qrHash" VARCHAR(64) NOT NULL,
    "amountCents" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    "description" VARCHAR(200),
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsage" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable "youth_wallet_controls"
CREATE TABLE "public"."youth_wallet_controls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "guardianUserId" UUID NOT NULL,
    "dailySpendLimit" BIGINT NOT NULL DEFAULT 8000,
    "singleTxnLimit" BIGINT NOT NULL DEFAULT 5000,
    "allowCashOut" BOOLEAN NOT NULL DEFAULT false,
    "allowedCategories" VARCHAR(500),
    "blockedCategories" VARCHAR(500),
    "notifyOnEveryTxn" BOOLEAN NOT NULL DEFAULT true,
    "notifyThresholdCents" BIGINT,
    "guardianPinForCashOut" BOOLEAN NOT NULL DEFAULT true,
    "guardianPinForLimitChange" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "youth_wallet_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable "agents"
CREATE TABLE "public"."agents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "agentCode" VARCHAR(20) NOT NULL,
    "businessName" VARCHAR(200) NOT NULL,
    "businessAddress" VARCHAR(500) NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "status" "public"."AgentStatus" NOT NULL DEFAULT 'TRAINING',
    "floatWalletId" UUID,
    "cashInCommissionBps" INTEGER NOT NULL DEFAULT 80,
    "cashOutCommissionBps" INTEGER NOT NULL DEFAULT 70,
    "minFloatCents" BIGINT NOT NULL DEFAULT 50000,
    "maxFloatCents" BIGINT NOT NULL DEFAULT 5000000,
    "bondDepositCents" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable "aml_flags"
CREATE TABLE "public"."aml_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "walletId" UUID,
    "transactionId" UUID,
    "flagType" VARCHAR(100) NOT NULL,
    "severity" "public"."AmlFlagSeverity" NOT NULL,
    "status" "public"."AmlFlagStatus" NOT NULL DEFAULT 'OPEN',
    "description" VARCHAR(2000) NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "evidenceJson" TEXT,
    "assignedTo" UUID,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "actionTaken" VARCHAR(1000),
    "strFilingRef" VARCHAR(100),
    "strFiledAt" TIMESTAMP(3),
    "dismissedReason" VARCHAR(500),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aml_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable "sanctions_screenings"
CREATE TABLE "public"."sanctions_screenings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "walletId" UUID,
    "transactionId" UUID,
    "screeningRef" VARCHAR(100) NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "matchFound" BOOLEAN NOT NULL DEFAULT false,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "bestMatchScore" DECIMAL(5,2),
    "screenedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateTable "notifications"
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(200),
    "body" TEXT NOT NULL,
    "metadata" TEXT,
    "externalRef" VARCHAR(200),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" VARCHAR(500),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable "audit_logs"
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(100),
    "changes" TEXT,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "deviceId" VARCHAR(200),
    "deviceFingerprint" VARCHAR(256),
    "outcome" VARCHAR(50) NOT NULL,
    "errorMessage" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "public"."users"("phoneNumber");
CREATE UNIQUE INDEX "users_phoneNumberHash_key" ON "public"."users"("phoneNumberHash");
CREATE INDEX "users_phoneNumberHash_idx" ON "public"."users"("phoneNumberHash");
CREATE INDEX "users_idNumberHash_idx" ON "public"."users"("idNumberHash");
CREATE INDEX "users_kycTier_idx" ON "public"."users"("kycTier");
CREATE INDEX "users_createdAt_idx" ON "public"."users"("createdAt");
CREATE UNIQUE INDEX "users_idNumberHash_key" ON "public"."users"("idNumberHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "public"."refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_idx" ON "public"."refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "public"."refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "kyc_documents_userId_idx" ON "public"."kyc_documents"("userId");
CREATE INDEX "kyc_documents_verificationStatus_idx" ON "public"."kyc_documents"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_walletNumber_key" ON "public"."wallets"("walletNumber");
CREATE INDEX "wallets_userId_idx" ON "public"."wallets"("userId");
CREATE INDEX "wallets_walletNumber_idx" ON "public"."wallets"("walletNumber");
CREATE INDEX "wallets_status_idx" ON "public"."wallets"("status");
CREATE INDEX "wallets_walletType_idx" ON "public"."wallets"("walletType");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotencyKey_key" ON "public"."wallet_transactions"("idempotencyKey");
CREATE INDEX "wallet_transactions_walletId_idx" ON "public"."wallet_transactions"("walletId");
CREATE INDEX "wallet_transactions_status_idx" ON "public"."wallet_transactions"("status");
CREATE INDEX "wallet_transactions_transactionType_idx" ON "public"."wallet_transactions"("transactionType");
CREATE INDEX "wallet_transactions_createdAt_idx" ON "public"."wallet_transactions"("createdAt");
CREATE INDEX "wallet_transactions_idempotencyKey_idx" ON "public"."wallet_transactions"("idempotencyKey");
CREATE INDEX "wallet_transactions_payshapRef_idx" ON "public"."wallet_transactions"("payshapRef");
CREATE INDEX "wallet_transactions_counterpartyWalletId_idx" ON "public"."wallet_transactions"("counterpartyWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_qr_codes_qrHash_key" ON "public"."payment_qr_codes"("qrHash");
CREATE INDEX "payment_qr_codes_walletId_idx" ON "public"."payment_qr_codes"("walletId");
CREATE INDEX "payment_qr_codes_qrHash_idx" ON "public"."payment_qr_codes"("qrHash");
CREATE INDEX "payment_qr_codes_expiresAt_idx" ON "public"."payment_qr_codes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "youth_wallet_controls_walletId_key" ON "public"."youth_wallet_controls"("walletId");
CREATE INDEX "youth_wallet_controls_guardianUserId_idx" ON "public"."youth_wallet_controls"("guardianUserId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_userId_key" ON "public"."agents"("userId");
CREATE UNIQUE INDEX "agents_agentCode_key" ON "public"."agents"("agentCode");
CREATE INDEX "agents_agentCode_idx" ON "public"."agents"("agentCode");
CREATE INDEX "agents_status_idx" ON "public"."agents"("status");

-- CreateIndex
CREATE INDEX "aml_flags_userId_idx" ON "public"."aml_flags"("userId");
CREATE INDEX "aml_flags_walletId_idx" ON "public"."aml_flags"("walletId");
CREATE INDEX "aml_flags_severity_idx" ON "public"."aml_flags"("severity");
CREATE INDEX "aml_flags_status_idx" ON "public"."aml_flags"("status");
CREATE INDEX "aml_flags_createdAt_idx" ON "public"."aml_flags"("createdAt");

-- CreateIndex
CREATE INDEX "sanctions_screenings_userId_idx" ON "public"."sanctions_screenings"("userId");
CREATE INDEX "sanctions_screenings_walletId_idx" ON "public"."sanctions_screenings"("walletId");
CREATE INDEX "sanctions_screenings_screenedAt_idx" ON "public"."sanctions_screenings"("screenedAt");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "public"."notifications"("userId");
CREATE INDEX "notifications_status_idx" ON "public"."notifications"("status");
CREATE INDEX "notifications_createdAt_idx" ON "public"."notifications"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "public"."audit_logs"("userId");
CREATE INDEX "audit_logs_action_idx" ON "public"."audit_logs"("action");
CREATE INDEX "audit_logs_createdAt_idx" ON "public"."audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kyc_documents" ADD CONSTRAINT "kyc_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_paymentQrId_fkey" FOREIGN KEY ("paymentQrId") REFERENCES "public"."payment_qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_qr_codes" ADD CONSTRAINT "payment_qr_codes_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."youth_wallet_controls" ADD CONSTRAINT "youth_wallet_controls_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."youth_wallet_controls" ADD CONSTRAINT "youth_wallet_controls_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_floatWalletId_fkey" FOREIGN KEY ("floatWalletId") REFERENCES "public"."wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."aml_flags" ADD CONSTRAINT "aml_flags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."aml_flags" ADD CONSTRAINT "aml_flags_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."aml_flags" ADD CONSTRAINT "aml_flags_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
