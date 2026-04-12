const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");

const prisma = new PrismaClient();

function hashForLookup(value) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

async function ensureUserWithWallet({
  phoneNumber,
  pin,
  deviceId,
  walletNumber,
  balanceCents,
  fullName,
}) {
  const phoneNumberHash = hashForLookup(phoneNumber);
  const pinHash = await argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    saltLength: 16,
  });

  const user = await prisma.user.upsert({
    where: { phoneNumberHash },
    update: {
      phoneNumber,
      pinHash,
      primaryDeviceId: deviceId,
      failedPinAttempts: 0,
      pinLockedUntil: null,
      isDeleted: false,
    },
    create: {
      phoneNumber,
      phoneNumberHash,
      pinHash,
      primaryDeviceId: deviceId,
      deviceBoundAt: new Date(),
      fullName,
      kycTier: "TIER_1",
      kycStatus: "VERIFIED",
      preferredLanguage: "en",
      isDeleted: false,
    },
  });

  const existingWallet = await prisma.wallet.findFirst({
    where: { userId: user.id, walletType: "PERSONAL", isDeleted: false },
  });

  if (existingWallet) {
    await prisma.wallet.update({
      where: { id: existingWallet.id },
      data: {
        walletNumber,
        status: "ACTIVE",
        kycTier: "TIER_1",
        balance: BigInt(balanceCents),
        dailyLimit: BigInt(500000),
        monthlyLimit: BigInt(5000000),
        maxBalance: BigInt(10000000),
        perTransactionLimit: BigInt(500000),
      },
    });
    return { userId: user.id, walletId: existingWallet.id };
  }

  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      walletNumber,
      walletType: "PERSONAL",
      status: "ACTIVE",
      kycTier: "TIER_1",
      balance: BigInt(balanceCents),
      dailyLimit: BigInt(500000),
      monthlyLimit: BigInt(5000000),
      maxBalance: BigInt(10000000),
      perTransactionLimit: BigInt(500000),
      currency: "ZAR",
    },
  });

  return { userId: user.id, walletId: wallet.id };
}

async function ensureFeePoolWallet() {
  const existing = await prisma.wallet.findFirst({
    where: { walletType: "FEE_POOL", isDeleted: false },
  });

  if (existing) return existing.id;

  const platformUser = await prisma.user.upsert({
    where: { phoneNumberHash: hashForLookup("+27999999990") },
    update: {},
    create: {
      phoneNumber: "+27999999990",
      phoneNumberHash: hashForLookup("+27999999990"),
      fullName: "Integration Platform User",
      kycTier: "MERCHANT",
      kycStatus: "VERIFIED",
      preferredLanguage: "en",
      isDeleted: false,
    },
  });

  const wallet = await prisma.wallet.create({
    data: {
      userId: platformUser.id,
      walletNumber: "AHV-FEES-INT-0001",
      walletType: "FEE_POOL",
      status: "ACTIVE",
      kycTier: "MERCHANT",
      balance: BigInt(0),
      dailyLimit: BigInt(999999999),
      monthlyLimit: BigInt(9999999999),
      maxBalance: BigInt(9999999999),
      perTransactionLimit: BigInt(999999999),
      currency: "ZAR",
    },
  });

  return wallet.id;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const sender = await ensureUserWithWallet({
    phoneNumber: "+27710000001",
    pin: "1234",
    deviceId: "integration-device-1",
    walletNumber: "AHV-INTE-SEND-0001",
    balanceCents: 500000,
    fullName: "Integration Sender",
  });

  const receiver = await ensureUserWithWallet({
    phoneNumber: "+27710000002",
    pin: "1234",
    deviceId: "integration-device-2",
    walletNumber: "AHV-INTE-RECV-0001",
    balanceCents: 10000,
    fullName: "Integration Receiver",
  });

  const feePoolWalletId = await ensureFeePoolWallet();

  console.log("Integration seed ready");
  console.log(JSON.stringify({ sender, receiver, feePoolWalletId }));
}

main()
  .catch((error) => {
    console.error("Integration seed failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
