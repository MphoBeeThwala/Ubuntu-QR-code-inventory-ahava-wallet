// packages/database/src/seed.ts
// Ahava eWallet — Development & Staging seed data
// Creates realistic South African test accounts, wallets, and transaction history
// RUN: npm run db:seed (NEVER run against production)

import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";
import { hashPin } from "@ahava/shared-crypto";

const prisma = new PrismaClient();
const KycTier = {
  TIER_0: "TIER_0",
  TIER_1: "TIER_1",
  MERCHANT: "MERCHANT",
} as const;
const AgentStatus = {
  ACTIVE: "ACTIVE",
} as const;

function hash(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

function _walletNumber(): string {
  const part = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `AHV-${part()}-${part()}-${part()}`;
}

function centsFromRand(rands: number): bigint {
  return BigInt(Math.round(rands * 100));
}

async function main() {
  console.log("🌱 Seeding Ahava eWallet development database...");

  if (process.env.NODE_ENV === "production") {
    throw new Error("SEED BLOCKED: Never run seed against production database");
  }

  const testPin = "1234";
  const pinHash = await hashPin(testPin);

  // ─────────────────────────────────────────────────────────────────
  // TEST USERS
  // ─────────────────────────────────────────────────────────────────

  console.log("Creating test users...");

  // 1. Tier 0 user — Unverified (basic phone + selfie)
  const tier0User = await prisma.user.upsert({
    where: { phoneNumberHash: hash("+27611234567") },
    update: { primaryDeviceId: null, deviceBoundAt: null },
    create: {
      phoneNumber: Buffer.from("+27611234567").toString("base64"), // Simulated encryption
      phoneNumberHash: hash("+27611234567"),
      fullName: "Nomsa Dlamini",
      preferredName: "Nomsa",
      kycTier: KycTier.TIER_0,
      kycStatus: "VERIFIED",
      preferredLanguage: "zu",
      pinHash,
      pinChangedAt: new Date(),
      popiConsentAt: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      termsAcceptedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      termsVersion: "1.0",
    },
  });

  // 2. Tier 1 user — Verified SA ID
  const tier1User = await prisma.user.upsert({
    where: { phoneNumberHash: hash("+27722345678") },
    update: { primaryDeviceId: null, deviceBoundAt: null },
    create: {
      phoneNumber: Buffer.from("+27722345678").toString("base64"),
      phoneNumberHash: hash("+27722345678"),
      fullName: "Gwede Mokoena",
      preferredName: "Gwede",
      kycTier: KycTier.TIER_1,
      kycStatus: "VERIFIED",
      idNumberHash: hash("8001015009087"),
      idType: "SA_ID_CARD",
      preferredLanguage: "en",
      pinHash,
      pinChangedAt: new Date(),
      popiConsentAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      termsAcceptedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      termsVersion: "1.0",
    },
  });

  // 3. Tier 2 merchant — Mama Thandi's Shop
  const merchantUser = await prisma.user.upsert({
    where: { phoneNumberHash: hash("+27833456789") },
    update: { primaryDeviceId: null, deviceBoundAt: null },
    create: {
      phoneNumber: Buffer.from("+27833456789").toString("base64"),
      phoneNumberHash: hash("+27833456789"),
      fullName: "Thandi Zulu",
      preferredName: "Mama Thandi",
      kycTier: KycTier.MERCHANT,
      kycStatus: "VERIFIED",
      idNumberHash: hash("7503155009087"),
      idType: "SA_ID_CARD",
      preferredLanguage: "zu",
      pinHash,
      pinChangedAt: new Date(),
      popiConsentAt: new Date(Date.now() - 90 * 24 * 3600 * 1000),
      termsAcceptedAt: new Date(Date.now() - 90 * 24 * 3600 * 1000),
      termsVersion: "1.0",
    },
  });

  // 4. Youth user — minor account
  const youthUser = await prisma.user.upsert({
    where: { phoneNumberHash: hash("+27611111111") },
    update: { primaryDeviceId: null, deviceBoundAt: null },
    create: {
      phoneNumber: Buffer.from("+27611111111").toString("base64"),
      phoneNumberHash: hash("+27611111111"),
      fullName: "Sipho Mokoena",
      preferredName: "Sipho",
      kycTier: KycTier.TIER_0,
      kycStatus: "VERIFIED",
      isMinor: true,
      guardianUserId: tier1User.id,
      preferredLanguage: "en",
      pinHash,
      pinChangedAt: new Date(),
      popiConsentAt: new Date(),
      termsAcceptedAt: new Date(),
      termsVersion: "1.0",
    },
  });

  // 5. Tumi — the sender in the demo scenario
  const tumiUser = await prisma.user.upsert({
    where: { phoneNumberHash: hash("+27799999999") },
    update: { primaryDeviceId: null, deviceBoundAt: null },
    create: {
      phoneNumber: Buffer.from("+27799999999").toString("base64"),
      phoneNumberHash: hash("+27799999999"),
      fullName: "Tumi Sole",
      preferredName: "Tumi",
      kycTier: KycTier.TIER_1,
      kycStatus: "VERIFIED",
      preferredLanguage: "st",
      pinHash,
      pinChangedAt: new Date(),
      popiConsentAt: new Date(),
      termsAcceptedAt: new Date(),
      termsVersion: "1.0",
    },
  });

  const agentUser = await prisma.user.upsert({
    where: { phoneNumberHash: hash("+27711112222") },
    update: {
      primaryDeviceId: null,
      deviceBoundAt: null,
      email: "agent@ubuntu.co.za",
    },
    create: {
      phoneNumber: Buffer.from("+27711112222").toString("base64"),
      phoneNumberHash: hash("+27711112222"),
      email: "agent@ubuntu.co.za",
      fullName: "Ubuntu Demo Agent",
      preferredName: "Demo Agent",
      kycTier: KycTier.TIER_1,
      kycStatus: "VERIFIED",
      preferredLanguage: "en",
      pinHash,
      pinChangedAt: new Date(),
      popiConsentAt: new Date(),
      termsAcceptedAt: new Date(),
      termsVersion: "1.0",
    },
  });

  console.log("✅ Test users created");

  // ─────────────────────────────────────────────────────────────────
  // WALLETS
  // ─────────────────────────────────────────────────────────────────

  console.log("Creating wallets...");

  const tier0Limits = {
    daily: centsFromRand(500),
    monthly: centsFromRand(2000),
    max: centsFromRand(2500),
    txn: centsFromRand(500),
  };
  const tier1Limits = {
    daily: centsFromRand(2000),
    monthly: centsFromRand(10000),
    max: centsFromRand(10000),
    txn: centsFromRand(2000),
  };
  const merchantLimits = {
    daily: centsFromRand(999999),
    monthly: centsFromRand(9999999),
    max: centsFromRand(9999999),
    txn: centsFromRand(999999),
  };

  const nnomsaWallet = await prisma.wallet.upsert({
    where: { walletNumber: "AHV-NOMS-3344-7721" },
    update: {
      balance: centsFromRand(245.5),
      walletType: "PERSONAL",
    },
    create: {
      userId: tier0User.id,
      walletNumber: "AHV-NOMS-3344-7721",
      walletType: "PERSONAL",
      status: "ACTIVE",
      kycTier: KycTier.TIER_0,
      balance: centsFromRand(245.5),
      dailyLimit: tier0Limits.daily,
      monthlyLimit: tier0Limits.monthly,
      maxBalance: tier0Limits.max,
      perTransactionLimit: tier0Limits.txn,
      currency: "ZAR",
    },
  });

  const gwwdeWallet = await prisma.wallet.upsert({
    where: { walletNumber: "AHV-GWED-7734-2291" },
    update: { balance: centsFromRand(1247.5) },
    create: {
      userId: tier1User.id,
      walletNumber: "AHV-GWED-7734-2291",
      walletType: "PERSONAL",
      status: "ACTIVE",
      kycTier: KycTier.TIER_1,
      balance: centsFromRand(1247.5),
      dailySpent: centsFromRand(247),
      monthlySpent: centsFromRand(3420),
      dailyLimit: tier1Limits.daily,
      monthlyLimit: tier1Limits.monthly,
      maxBalance: tier1Limits.max,
      perTransactionLimit: tier1Limits.txn,
      currency: "ZAR",
    },
  });

  const thaandiWallet = await prisma.wallet.upsert({
    where: { walletNumber: "AHV-THAN-5582-3394" },
    update: { balance: centsFromRand(8430.0) },
    create: {
      userId: merchantUser.id,
      walletNumber: "AHV-THAN-5582-3394",
      walletType: "MERCHANT",
      status: "ACTIVE",
      kycTier: KycTier.MERCHANT,
      balance: centsFromRand(8430.0),
      dailyLimit: merchantLimits.daily,
      monthlyLimit: merchantLimits.monthly,
      maxBalance: merchantLimits.max,
      perTransactionLimit: merchantLimits.txn,
      currency: "ZAR",
    },
  });

  const tuumiWallet = await prisma.wallet.upsert({
    where: { walletNumber: "AHV-TUMI-3321-8894" },
    update: { balance: centsFromRand(3200.0) },
    create: {
      userId: tumiUser.id,
      walletNumber: "AHV-TUMI-3321-8894",
      walletType: "PERSONAL",
      status: "ACTIVE",
      kycTier: KycTier.TIER_1,
      balance: centsFromRand(3200.0),
      dailyLimit: tier1Limits.daily,
      monthlyLimit: tier1Limits.monthly,
      maxBalance: tier1Limits.max,
      perTransactionLimit: tier1Limits.txn,
      currency: "ZAR",
    },
  });

  // Youth wallet for Sipho
  const siphoWallet = await prisma.wallet.upsert({
    where: { walletNumber: "AHV-SIPH-9910-4421" },
    update: { balance: centsFromRand(45.0) },
    create: {
      userId: youthUser.id,
      walletNumber: "AHV-SIPH-9910-4421",
      walletType: "YOUTH",
      status: "ACTIVE",
      kycTier: KycTier.TIER_0,
      balance: centsFromRand(45.0),
      dailyLimit: centsFromRand(80),
      monthlyLimit: centsFromRand(400),
      maxBalance: centsFromRand(500),
      perTransactionLimit: centsFromRand(50),
      currency: "ZAR",
    },
  });

  const agentFloatWallet = await prisma.wallet.upsert({
    where: { walletNumber: "AHV-AGNT-1100-2200" },
    update: { balance: centsFromRand(15000.0) },
    create: {
      userId: agentUser.id,
      walletNumber: "AHV-AGNT-1100-2200",
      walletType: "AGENT",
      status: "ACTIVE",
      kycTier: KycTier.TIER_1,
      balance: centsFromRand(15000.0),
      dailyLimit: merchantLimits.daily,
      monthlyLimit: merchantLimits.monthly,
      maxBalance: merchantLimits.max,
      perTransactionLimit: merchantLimits.txn,
      currency: "ZAR",
    },
  });

  // Youth control settings
  await prisma.youthWalletControl.upsert({
    where: { walletId: siphoWallet.id },
    update: {},
    create: {
      walletId: siphoWallet.id,
      guardianUserId: tier1User.id,
      dailySpendLimit: centsFromRand(80),
      singleTxnLimit: centsFromRand(50),
      allowCashOut: false,
      allowedCategories: "FOOD,EDUCATION,PHARMACY,TRANSPORT",
      blockedCategories: "LIQUOR,GAMBLING,ADULT_ENTERTAINMENT",
      notifyOnEveryTxn: true,
      notifyThresholdCents: centsFromRand(20),
      guardianPinForCashOut: true,
    },
  });

  // System fee pool wallet
  await prisma.wallet.upsert({
    where: { walletNumber: "AHV-FEES-0000-0001" },
    update: {},
    create: {
      userId: merchantUser.id, // Temporary — replace with system user
      walletNumber: "AHV-FEES-0000-0001",
      walletType: "FEE_POOL",
      status: "ACTIVE",
      kycTier: KycTier.MERCHANT,
      balance: BigInt(0),
      dailyLimit: merchantLimits.daily,
      monthlyLimit: merchantLimits.monthly,
      maxBalance: merchantLimits.max,
      perTransactionLimit: merchantLimits.txn,
      currency: "ZAR",
    },
  });

  console.log("✅ Wallets created");

  // ─────────────────────────────────────────────────────────────────
  await prisma.agent.upsert({
    where: { userId: agentUser.id },
    update: {
      status: AgentStatus.ACTIVE,
      businessName: "Ubuntu Demo Agent",
      businessAddress: "Soweto Demo Corridor, Johannesburg",
      floatWalletId: agentFloatWallet.id,
    },
    create: {
      userId: agentUser.id,
      agentCode: "AHV-AGT-00001",
      businessName: "Ubuntu Demo Agent",
      businessAddress: "Soweto Demo Corridor, Johannesburg",
      status: AgentStatus.ACTIVE,
      floatWalletId: agentFloatWallet.id,
      cashInCommissionBps: 80,
      cashOutCommissionBps: 70,
      minFloatCents: centsFromRand(500),
      maxFloatCents: centsFromRand(50000),
      bondDepositCents: centsFromRand(1000),
    },
  });

  const demoMerchantQrPayload = JSON.stringify({
    walletId: thaandiWallet.id,
    walletNumber: thaandiWallet.walletNumber,
    qrType: "STATIC",
    currency: "ZAR",
    merchantName: "Mama Thandi",
    description: "Ubuntu merchant payment for goods and services",
    issuedAt: "2026-01-01T00:00:00.000Z",
  });

  const demoMerchantQrHash = crypto
    .createHash("sha256")
    .update(demoMerchantQrPayload)
    .digest("hex");

  const merchantDemoQr =
    (await prisma.paymentQrCode.findFirst({
      where: { qrHash: demoMerchantQrHash },
    })) ??
    (await prisma.paymentQrCode.create({
      data: {
        walletId: thaandiWallet.id,
        qrType: "STATIC",
        qrPayload: demoMerchantQrPayload,
        qrHash: demoMerchantQrHash,
        amountCents: null,
        currency: "ZAR",
        description: "Ubuntu merchant payment for goods and services",
        expiresAt: null,
        maxUsage: null,
        isActive: true,
      },
    }));

  // SEED FEE RULES
  // ─────────────────────────────────────────────────────────────────

  console.log("Creating fee rules...");

  await prisma.feeRule.createMany({
    data: [
      {
        ruleName: "Family transfer — free under R200",
        paymentMethod: "UBUNTUPAY_WALLET",
        transactionType: "DEBIT",
        minAmountCents: BigInt(300),
        maxAmountCents: BigInt(20000),
        flatFeeCents: BigInt(0),
        percentageBps: 0,
        description:
          "Free wallet-to-wallet transfers under R200 for family remittance",
      },
      {
        ruleName: "Micro payment R3–R100",
        paymentMethod: "UBUNTUPAY_WALLET",
        transactionType: "DEBIT",
        minAmountCents: BigInt(300),
        maxAmountCents: BigInt(10000),
        flatFeeCents: BigInt(50), // R0.50
        percentageBps: 0,
        description: "Flat R0.50 fee for payments between R3 and R100",
      },
      {
        ruleName: "Standard payment R101–R500",
        paymentMethod: "UBUNTUPAY_WALLET",
        transactionType: "DEBIT",
        minAmountCents: BigInt(10001),
        maxAmountCents: BigInt(50000),
        flatFeeCents: BigInt(100), // R1.00
        percentageBps: 0,
        description: "Flat R1.00 fee for payments between R101 and R500",
      },
      {
        ruleName: "Large payment above R500",
        paymentMethod: "UBUNTUPAY_WALLET",
        transactionType: "DEBIT",
        minAmountCents: BigInt(50001),
        maxAmountCents: null,
        flatFeeCents: BigInt(0),
        percentageBps: 50, // 0.5%
        description: "0.5% fee for payments above R500",
      },
    ],
  });

  console.log("✅ Fee rules created");

  // ─────────────────────────────────────────────────────────────────
  // SEED SYSTEM CONFIG
  // ─────────────────────────────────────────────────────────────────

  await prisma.systemConfig.createMany({
    data: [
      {
        key: "platform.min_payment_cents",
        value: "300",
        description: "Minimum payment amount in cents (R3)",
      },
      {
        key: "platform.max_cash_in_daily_cents",
        value: "500000",
        description: "Maximum cash-in per day (R5,000)",
      },
      {
        key: "platform.aml.velocity_threshold",
        value: "20",
        description: "Max transactions per hour before AML flag",
      },
      {
        key: "platform.aml.round_trip_window_minutes",
        value: "10",
        description: "Round-trip detection window in minutes",
      },
      {
        key: "platform.kyc.pin_lockout_attempts",
        value: "5",
        description: "PIN attempts before lockout",
      },
      {
        key: "platform.kyc.pin_lockout_minutes",
        value: "30",
        description: "PIN lockout duration in minutes",
      },
      {
        key: "platform.payshap.timeout_seconds",
        value: "30",
        description: "PayShap API timeout in seconds",
      },
      {
        key: "platform.vat_rate_bps",
        value: "1500",
        description: "VAT rate in basis points (15%)",
      },
      {
        key: "maintenance.mode",
        value: "false",
        description: "If true, API returns 503 for non-admin requests",
      },
    ],
    skipDuplicates: true,
  });

  console.log("✅ System config seeded");

  console.log("\n🎉 Seed complete!\n");
  console.log("Test accounts (all PIN: 1234):");
  console.log(
    `  Nomsa (Tier 0)       +27611234567   ${nnomsaWallet.walletNumber}   PIN: 1234`,
  );
  console.log(
    `  Gwede (Tier 1)       +27722345678   ${gwwdeWallet.walletNumber}   PIN: 1234`,
  );
  console.log(
    `  Mama Thandi (Merch)  +27833456789   ${thaandiWallet.walletNumber}   PIN: 1234`,
  );
  console.log(
    `  Merchant demo QR     ubuntu://pay?qr=${merchantDemoQr.qrHash}`,
  );
  console.log(
    `  Tumi (Tier 1)        +27799999999   ${tuumiWallet.walletNumber}   PIN: 1234`,
  );
  console.log(
    `  Demo Agent           agent@ubuntu.co.za   ${agentFloatWallet.walletNumber}   PIN: 1234`,
  );
  console.log(
    `  Sipho (Youth)        +27611111111   ${siphoWallet.walletNumber}   PIN: 1234`,
  );
  console.log(
    "  (No device binding — first login from any device auto-binds it)",
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
