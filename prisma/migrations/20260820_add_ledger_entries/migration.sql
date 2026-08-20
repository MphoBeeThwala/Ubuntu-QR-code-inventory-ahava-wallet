-- Migration: Add ledger_entries table
-- Created for BATCH 1: Database + Ledger Foundation
-- This migration creates the ledger_entries table that was previously missing from Prisma schema

CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transactionId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "userId" UUID,
    "entryType" "EntryType" NOT NULL,
    "accountCode" VARCHAR(20) NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    "description" TEXT,
    "reference" VARCHAR(255),
    "counterpartyWalletId" UUID,
    "counterpartyAccountCode" VARCHAR(20),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("id")
);

-- Create indexes for query performance
CREATE INDEX "ledger_entries_transactionId_idx" ON "ledger_entries" ("transactionId");
CREATE INDEX "ledger_entries_walletId_idx" ON "ledger_entries" ("walletId");
CREATE INDEX "ledger_entries_accountCode_idx" ON "ledger_entries" ("accountCode");
CREATE INDEX "ledger_entries_createdAt_idx" ON "ledger_entries" ("createdAt");

-- Create the EntryType enum type
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- Add comment
COMMENT ON TABLE "ledger_entries" IS 'Double-entry accounting ledger for tracking all financial transactions. Each transaction generates at least two entries (debit and credit) that must balance.';
COMMENT ON COLUMN "ledger_entries"."amountCents" IS 'Monetary amount in cents (integer) to avoid floating-point precision issues.';
COMMENT ON COLUMN "ledger_entries"."entryType" IS 'DEBIT or CREDIT - follows double-entry accounting principles.';
COMMENT ON COLUMN "ledger_entries"."accountCode" IS 'Chart of accounts code (e.g., 1100 for customer wallets, 1200 for fee pool).';
