/*
  Warnings:

  - You are about to drop the column `actionTaken` on the `aml_flags` table. All the data in the column will be lost.
  - You are about to drop the column `dismissedAt` on the `aml_flags` table. All the data in the column will be lost.
  - You are about to drop the column `dismissedReason` on the `aml_flags` table. All the data in the column will be lost.
  - You are about to drop the column `reviewedBy` on the `aml_flags` table. All the data in the column will be lost.
  - You are about to drop the column `strFilingRef` on the `aml_flags` table. All the data in the column will be lost.
  - You are about to drop the column `changes` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `deviceFingerprint` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `errorMessage` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `outcome` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `resource` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `resourceId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `notifications` table. All the data in the column will be lost.
  - You are about to alter the column `body` on the `notifications` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(1000)`.
  - You are about to drop the column `bestMatchScore` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `matchCount` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `matchFound` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `rawResponse` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `screeningRef` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `transactionId` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `sanctions_screenings` table. All the data in the column will be lost.
  - You are about to drop the column `walletId` on the `sanctions_screenings` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[floatWalletId]` on the table `agents` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `serviceId` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Made the column `title` on table `notifications` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `entityId` to the `sanctions_screenings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityType` to the `sanctions_screenings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `provider` to the `sanctions_screenings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `result` to the `sanctions_screenings` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "aml_flags" DROP CONSTRAINT "aml_flags_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "aml_flags" DROP CONSTRAINT "aml_flags_walletId_fkey";

-- DropForeignKey
ALTER TABLE "sanctions_screenings" DROP CONSTRAINT "sanctions_screenings_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "sanctions_screenings" DROP CONSTRAINT "sanctions_screenings_userId_fkey";

-- DropForeignKey
ALTER TABLE "sanctions_screenings" DROP CONSTRAINT "sanctions_screenings_walletId_fkey";

-- DropIndex
DROP INDEX "payment_qr_codes_qrHash_key";

-- DropIndex
DROP INDEX "sanctions_screenings_userId_idx";

-- DropIndex
DROP INDEX "sanctions_screenings_walletId_idx";

-- DropIndex
DROP INDEX "users_idNumberHash_key";

-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "aml_flags" DROP COLUMN "actionTaken",
DROP COLUMN "dismissedAt",
DROP COLUMN "dismissedReason",
DROP COLUMN "reviewedBy",
DROP COLUMN "strFilingRef",
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "autoResolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "reviewNote" VARCHAR(2000),
ADD COLUMN     "strReference" VARCHAR(100),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "changes",
DROP COLUMN "deviceFingerprint",
DROP COLUMN "errorMessage",
DROP COLUMN "outcome",
DROP COLUMN "resource",
DROP COLUMN "resourceId",
ADD COLUMN     "correlationId" VARCHAR(36),
ADD COLUMN     "entityId" UUID,
ADD COLUMN     "entityType" VARCHAR(100),
ADD COLUMN     "newState" TEXT,
ADD COLUMN     "previousState" TEXT,
ADD COLUMN     "serviceId" VARCHAR(50) NOT NULL,
ALTER COLUMN "action" SET DATA TYPE VARCHAR(200);

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "metadata",
ADD COLUMN     "data" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "templateId" VARCHAR(100),
ALTER COLUMN "title" SET NOT NULL,
ALTER COLUMN "body" SET DATA TYPE VARCHAR(1000);

-- AlterTable
ALTER TABLE "sanctions_screenings" DROP COLUMN "bestMatchScore",
DROP COLUMN "createdAt",
DROP COLUMN "matchCount",
DROP COLUMN "matchFound",
DROP COLUMN "rawResponse",
DROP COLUMN "screeningRef",
DROP COLUMN "transactionId",
DROP COLUMN "userId",
DROP COLUMN "walletId",
ADD COLUMN     "entityId" UUID NOT NULL,
ADD COLUMN     "entityType" VARCHAR(20) NOT NULL,
ADD COLUMN     "matchDetails" TEXT,
ADD COLUMN     "provider" VARCHAR(50) NOT NULL,
ADD COLUMN     "responseTimeMs" INTEGER,
ADD COLUMN     "result" VARCHAR(20) NOT NULL,
ALTER COLUMN "screenedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wallets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "youth_wallet_controls" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "payshap_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ahavaTransactionId" UUID NOT NULL,
    "payshapMsgId" VARCHAR(100) NOT NULL,
    "payshapEndToEndId" VARCHAR(100) NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    "debtorName" VARCHAR(200) NOT NULL,
    "debtorAccountRef" VARCHAR(100) NOT NULL,
    "creditorName" VARCHAR(200) NOT NULL,
    "creditorAccountRef" VARCHAR(100) NOT NULL,
    "remittanceInfo" VARCHAR(140),
    "status" VARCHAR(50) NOT NULL,
    "statusReason" VARCHAR(200),
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rawRequest" TEXT,
    "rawResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payshap_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleName" VARCHAR(100) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "minAmountCents" BIGINT NOT NULL DEFAULT 0,
    "maxAmountCents" BIGINT,
    "flatFeeCents" BIGINT NOT NULL DEFAULT 0,
    "percentageBps" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "description" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" VARCHAR(200) NOT NULL,
    "value" TEXT NOT NULL,
    "description" VARCHAR(500),
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "payshap_transactions_payshapMsgId_key" ON "payshap_transactions"("payshapMsgId");

-- CreateIndex
CREATE INDEX "payshap_transactions_ahavaTransactionId_idx" ON "payshap_transactions"("ahavaTransactionId");

-- CreateIndex
CREATE INDEX "payshap_transactions_payshapMsgId_idx" ON "payshap_transactions"("payshapMsgId");

-- CreateIndex
CREATE INDEX "payshap_transactions_status_idx" ON "payshap_transactions"("status");

-- CreateIndex
CREATE INDEX "fee_rules_paymentMethod_transactionType_isActive_idx" ON "fee_rules"("paymentMethod", "transactionType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "agents_floatWalletId_key" ON "agents"("floatWalletId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "sanctions_screenings_entityId_idx" ON "sanctions_screenings"("entityId");
