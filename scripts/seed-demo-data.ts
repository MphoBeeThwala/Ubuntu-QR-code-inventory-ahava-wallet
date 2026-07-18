import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  // Clean existing demo data
  await prisma.walletTransaction.deleteMany();
  await prisma.paymentQrCode.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();

  // ========== CONSUMERS ==========
  const consumer1 = await prisma.user.create({
    data: {
      phoneNumber: '+27821111111',
      phoneNumberHash: createHash('sha256').update('+27821111111').digest('hex'),
      fullName: 'Thabo Consumer',
      preferredName: 'Thabo',
      pinHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGVkZ2V0aW5nYXJnb252YWx1ZQ$...',
      kycTier: 'TIER_1',
      kycStatus: 'VERIFIED',
      email: 'thabo@example.com',
      emailVerified: true,
    }
  });

  const consumer2 = await prisma.user.create({
    data: {
      phoneNumber: '+27822222222',
      phoneNumberHash: createHash('sha256').update('+27822222222').digest('hex'),
      fullName: 'Lerato Shopper',
      preferredName: 'Lerato',
      pinHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGVkZ2V0aW5nYXJnb252YWx1ZQ$...',
      kycTier: 'TIER_1',
      kycStatus: 'VERIFIED',
    }
  });

  // Create wallets with seeded balances
  const wallet1 = await prisma.wallet.create({
    data: {
      userId: consumer1.id,
      walletNumber: 'UBUNTU-0001-0001-0001',
      walletType: 'PERSONAL',
      balance: BigInt(500000), // R5000
      currency: 'ZAR',
      kycTier: 'TIER_1',
      dailyLimit: BigInt(200000), // R2000
      monthlyLimit: BigInt(1000000), // R10,000
      maxBalance: BigInt(1000000),
    }
  });

  const wallet2 = await prisma.wallet.create({
    data: {
      userId: consumer2.id,
      walletNumber: 'UBUNTU-0002-0002-0002',
      walletType: 'PERSONAL',
      balance: BigInt(250000), // R2500
      currency: 'ZAR',
      kycTier: 'TIER_1',
    }
  });

  // ========== MERCHANTS ==========
  const merchant1 = await prisma.user.create({
    data: {
      phoneNumber: '+27833333333',
      phoneNumberHash: createHash('sha256').update('+27833333333').digest('hex'),
      fullName: 'Spaza Shop',
      preferredName: 'Spaza Shop',
      kycTier: 'MERCHANT',
      kycStatus: 'VERIFIED',
      email: 'spaza@example.com',
    }
  });

  const merchantWallet = await prisma.wallet.create({
    data: {
      userId: merchant1.id,
      walletNumber: 'UBUNTU-MERCH-001',
      walletType: 'MERCHANT',
      balance: BigInt(0),
      currency: 'ZAR',
      kycTier: 'MERCHANT',
    }
  });

  // ========== AGENTS ==========
  const agent1 = await prisma.user.create({
    data: {
      phoneNumber: '+27844444444',
      phoneNumberHash: createHash('sha256').update('+27844444444').digest('hex'),
      fullName: 'Agent Smith',
      preferredName: 'Agent Smith',
      kycTier: 'TIER_2',
      kycStatus: 'VERIFIED',
    }
  });

  const agent = await prisma.agent.create({
    data: {
      userId: agent1.id,
      agentCode: 'UBUNTU-AGT-001',
      businessName: 'Ubuntu Agent - Soweto',
      businessAddress: '123 Main Street, Soweto',
      status: 'ACTIVE',
      cashInCommissionBps: 80,
      cashOutCommissionBps: 70,
      minFloatCents: BigInt(50000),
      maxFloatCents: BigInt(5000000),
    }
  });

  const agentWallet = await prisma.wallet.create({
    data: {
      userId: agent1.id,
      walletNumber: 'UBUNTU-AGENT-001',
      walletType: 'AGENT',
      balance: BigInt(1000000), // R10,000 float
      currency: 'ZAR',
      kycTier: 'TIER_2',
    }
  });

  // Update agent with float wallet
  await prisma.agent.update({
    where: { id: agent.id },
    data: { floatWalletId: agentWallet.id }
  });

  // ========== FEE POOL ==========
  await prisma.wallet.create({
    data: {
      userId: '00000000-0000-0000-0000-000000000000',
      walletNumber: 'UBUNTU-FEE-POOL',
      walletType: 'FEE_POOL',
      balance: BigInt(0),
      currency: 'ZAR',
      kycTier: 'MERCHANT',
    }
  });

  // ========== INVENTORY PRODUCTS ==========
  const products = [
    {
      name: 'Bread (White)',
      description: 'Fresh white bread loaf',
      category: 'FOOD',
      priceCents: 1500,
      sku: 'BRD-WHT-001',
      trackStock: true,
    },
    {
      name: 'Milk (1L)',
      description: 'Full cream milk',
      category: 'DRINKS',
      priceCents: 2200,
      sku: 'MLK-FULL-001',
      trackStock: true,
    },
    {
      name: 'Eggs (6)',
      description: 'Free range eggs',
      category: 'FOOD',
      priceCents: 2500,
      sku: 'EGG-FREE-006',
      trackStock: true,
    },
    {
      name: 'Cooking Oil (750ml)',
      description: 'Sunflower cooking oil',
      category: 'GROCERIES',
      priceCents: 3500,
      sku: 'OIL-SUN-750',
      trackStock: true,
    },
    {
      name: 'Sugar (2kg)',
      description: 'White sugar',
      category: 'GROCERIES',
      priceCents: 4500,
      sku: 'SUG-WHT-2KG',
      trackStock: true,
    },
  ];

  for (const productData of products) {
    const product = await prisma.inventoryProduct.create({
      data: {
        merchantId: merchant1.id,
        ...productData,
        qrPayload: JSON.stringify({
          type: 'INVENTORY_PRODUCT',
          merchantId: merchant1.id,
          name: productData.name,
          priceCents: productData.priceCents,
          currency: 'ZAR',
        }),
        qrHash: createHash('sha256')
          .update(JSON.stringify(productData))
          .digest('hex'),
      }
    });

    // Create stock
    await prisma.inventoryStock.create({
      data: {
        productId: product.id,
        quantity: 50,
        lowStockAlert: 10,
        location: 'Shelf A',
      }
    });

    console.log(`  - Product: ${product.name} (R${product.priceCents / 100})`);
  }

  console.log('✅ Demo data seeded successfully!');
  console.log('📋 Users created:');
  console.log(`  - Consumer 1: ${consumer1.phoneNumber} (Wallet: ${wallet1.walletNumber}, Balance: R${wallet1.balance / 100})`);
  console.log(`  - Consumer 2: ${consumer2.phoneNumber} (Wallet: ${wallet2.walletNumber}, Balance: R${wallet2.balance / 100})`);
  console.log(`  - Merchant: ${merchant1.phoneNumber} (Wallet: ${merchantWallet.walletNumber})`);
  console.log(`  - Agent: ${agent1.phoneNumber} (Wallet: ${agentWallet.walletNumber}, Balance: R${agentWallet.balance / 100})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
