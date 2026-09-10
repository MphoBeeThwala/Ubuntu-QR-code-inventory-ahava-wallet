-- Migration: Add inventory tables (Sprint 0 P0 fix)
--
-- services/inventory-service has called prisma.inventoryProduct /
-- prisma.inventoryStock / prisma.inventoryTransaction since it was written,
-- but no migration ever created these tables and they were never declared
-- in schema.prisma either — the service was entirely unbacked by the
-- database. This migration creates them to match the corrected schema.prisma.

CREATE TABLE "inventory_products" (
    "id" TEXT NOT NULL,
    "merchantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100),
    "priceCents" BIGINT NOT NULL,
    "costCents" BIGINT,
    "sku" VARCHAR(100),
    "barcode" VARCHAR(100),
    "trackStock" BOOLEAN NOT NULL DEFAULT false,
    "qrPayload" TEXT NOT NULL,
    "qrHash" VARCHAR(64) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_stock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "lowStockAlert" INTEGER NOT NULL DEFAULT 5,
    "lastRestocked" TIMESTAMP(3),
    "location" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" BIGINT,
    "totalCents" BIGINT,
    "walletTransactionId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_products_qrHash_key" ON "inventory_products"("qrHash");
CREATE INDEX "inventory_products_merchantId_idx" ON "inventory_products"("merchantId");
CREATE INDEX "inventory_products_isActive_idx" ON "inventory_products"("isActive");

CREATE UNIQUE INDEX "inventory_stock_productId_key" ON "inventory_stock"("productId");

CREATE INDEX "inventory_transactions_productId_idx" ON "inventory_transactions"("productId");
CREATE INDEX "inventory_transactions_type_idx" ON "inventory_transactions"("type");
CREATE INDEX "inventory_transactions_createdAt_idx" ON "inventory_transactions"("createdAt");

ALTER TABLE "inventory_products" ADD CONSTRAINT "inventory_products_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
