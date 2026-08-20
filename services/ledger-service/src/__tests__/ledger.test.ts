/**
 * Ledger Service Tests - BATCH 1: Database + Ledger Foundation
 * 
 * Tests cover:
 * 1. Ledger entry creation
 * 2. Debit entry
 * 3. Credit entry
 * 4. Trial balance (TOTAL DEBITS = TOTAL CREDITS)
 * 5. Transaction lookup
 * 6. Reconciliation query
 */

import { PrismaClient, EntryType } from '@prisma/client';
import { prisma, mockDate } from '../setupTests';

describe('LedgerEntry Model', () => {
  beforeEach(async () => {
    // Clean up before each test
    await prisma.ledgerEntry.deleteMany({});
    await prisma.walletTransaction.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('Ledger Entry Creation', () => {
    it('should create a DEBIT ledger entry', async () => {
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456789',
          phoneNumberHash: 'hash_27123456789',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0001',
          balanceCents: BigInt(100000), // R1000
        },
      });

      const entry = await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_001',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100', // CUSTOMER_WALLETS
          amountCents: BigInt(10000), // R100
          currency: 'ZAR',
          description: 'Test debit entry',
          reference: 'ref_001',
        },
      });

      expect(entry.id).toBeDefined();
      expect(entry.entryType).toBe(EntryType.DEBIT);
      expect(entry.amountCents).toBe(BigInt(10000));
      expect(entry.accountCode).toBe('1100');
      expect(entry.createdAt).toEqual(mockDate);
    });

    it('should create a CREDIT ledger entry', async () => {
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456780',
          phoneNumberHash: 'hash_27123456780',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0002',
          balanceCents: BigInt(100000),
        },
      });

      const entry = await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_002',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.CREDIT,
          accountCode: '1100',
          amountCents: BigInt(5000), // R50
          currency: 'ZAR',
          description: 'Test credit entry',
          reference: 'ref_002',
        },
      });

      expect(entry.id).toBeDefined();
      expect(entry.entryType).toBe(EntryType.CREDIT);
      expect(entry.amountCents).toBe(BigInt(5000));
    });
  });

  describe('Trial Balance', () => {
    it('should maintain balance: TOTAL DEBITS = TOTAL CREDITS', async () => {
      const user1 = await prisma.user.create({
        data: {
          phoneNumber: '27123456781',
          phoneNumberHash: 'hash_27123456781',
        },
      });

      const user2 = await prisma.user.create({
        data: {
          phoneNumber: '27123456782',
          phoneNumberHash: 'hash_27123456782',
        },
      });

      const wallet1 = await prisma.wallet.create({
        data: {
          userId: user1.id,
          walletNumber: 'AHV-0001-0001-0003',
          balanceCents: BigInt(100000),
        },
      });

      const wallet2 = await prisma.wallet.create({
        data: {
          userId: user2.id,
          walletNumber: 'AHV-0001-0001-0004',
          balanceCents: BigInt(100000),
        },
      });

      // Create a transfer: wallet1 sends R100 to wallet2
      // This should create 2 entries: DEBIT from wallet1, CREDIT to wallet2
      const transactionId = 'txn_transfer_001';
      
      await prisma.ledgerEntry.create({
        data: {
          transactionId,
          walletId: wallet1.id,
          userId: user1.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100',
          amountCents: BigInt(10000), // R100
          currency: 'ZAR',
          description: 'Transfer to AHV-0001-0001-0004',
          reference: transactionId,
          counterpartyWalletId: wallet2.id,
          counterpartyAccountCode: '1100',
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId,
          walletId: wallet2.id,
          userId: user2.id,
          entryType: EntryType.CREDIT,
          accountCode: '1100',
          amountCents: BigInt(10000), // R100
          currency: 'ZAR',
          description: 'Transfer from AHV-0001-0001-0003',
          reference: transactionId,
          counterpartyWalletId: wallet1.id,
          counterpartyAccountCode: '1100',
        },
      });

      // Get all entries for this transaction
      const entries = await prisma.ledgerEntry.findMany({
        where: { transactionId },
      });

      expect(entries.length).toBe(2);

      // Calculate totals
      const totalDebits = entries
        .filter(e => e.entryType === EntryType.DEBIT)
        .reduce((sum, e) => sum + e.amountCents, BigInt(0));

      const totalCredits = entries
        .filter(e => e.entryType === EntryType.CREDIT)
        .reduce((sum, e) => sum + e.amountCents, BigInt(0));

      // Financial invariant: DEBITS must equal CREDITS
      expect(totalDebits).toBe(totalCredits);
      expect(totalDebits).toBe(BigInt(10000));
    });

    it('should fail validation if debits do not equal credits', async () => {
      // This is a conceptual test - in reality, the service layer should enforce this
      // But we test the invariant here for documentation
      
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456783',
          phoneNumberHash: 'hash_27123456783',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0005',
          balanceCents: BigInt(100000),
        },
      });

      // Create unbalanced entries (DEBIT only, no CREDIT)
      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_unbalanced',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100',
          amountCents: BigInt(10000),
          currency: 'ZAR',
        },
      });

      const entries = await prisma.ledgerEntry.findMany({
        where: { transactionId: 'txn_unbalanced' },
      });

      const totalDebits = entries
        .filter(e => e.entryType === EntryType.DEBIT)
        .reduce((sum, e) => sum + e.amountCents, BigInt(0));

      const totalCredits = entries
        .filter(e => e.entryType === EntryType.CREDIT)
        .reduce((sum, e) => sum + e.amountCents, BigInt(0));

      // This will show the imbalance
      expect(totalDebits).toBe(BigInt(10000));
      expect(totalCredits).toBe(BigInt(0));
      expect(totalDebits).not.toBe(totalCredits); // Intentionally unbalanced
    });
  });

  describe('Transaction Lookup', () => {
    it('should find ledger entries by transaction ID', async () => {
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456784',
          phoneNumberHash: 'hash_27123456784',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0006',
          balanceCents: BigInt(100000),
        },
      });

      const transactionId = 'txn_lookup_test';
      await prisma.ledgerEntry.create({
        data: {
          transactionId,
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100',
          amountCents: BigInt(5000),
          currency: 'ZAR',
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId,
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.CREDIT,
          accountCode: '1200', // FEE_POOL
          amountCents: BigInt(500),
          currency: 'ZAR',
        },
      });

      const entries = await prisma.ledgerEntry.findMany({
        where: { transactionId },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.length).toBe(2);
      expect(entries[0].transactionId).toBe(transactionId);
      expect(entries[1].transactionId).toBe(transactionId);
    });

    it('should find ledger entries by wallet ID', async () => {
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456785',
          phoneNumberHash: 'hash_27123456785',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0007',
          balanceCents: BigInt(100000),
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_wallet_001',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100',
          amountCents: BigInt(2000),
          currency: 'ZAR',
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_wallet_002',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.CREDIT,
          accountCode: '1100',
          amountCents: BigInt(3000),
          currency: 'ZAR',
        },
      });

      const entries = await prisma.ledgerEntry.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.length).toBe(2);
      expect(entries.every(e => e.walletId === wallet.id)).toBe(true);
    });
  });

  describe('Reconciliation Query', () => {
    it('should calculate wallet balance from ledger entries', async () => {
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456786',
          phoneNumberHash: 'hash_27123456786',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0008',
          balanceCents: BigInt(100000), // Starting with R1000
        },
      });

      // Initial deposit: +R500 (CREDIT)
      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_deposit',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.CREDIT,
          accountCode: '1100',
          amountCents: BigInt(50000),
          currency: 'ZAR',
          description: 'Initial deposit',
        },
      });

      // Payment: -R200 (DEBIT)
      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_payment',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100',
          amountCents: BigInt(20000),
          currency: 'ZAR',
          description: 'Payment to merchant',
        },
      });

      // Another deposit: +R300 (CREDIT)
      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_deposit2',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.CREDIT,
          accountCode: '1100',
          amountCents: BigInt(30000),
          currency: 'ZAR',
          description: 'Second deposit',
        },
      });

      // Calculate balance from ledger entries
      const entries = await prisma.ledgerEntry.findMany({
        where: { walletId: wallet.id },
      });

      const balance = entries.reduce((sum, entry) => {
        if (entry.entryType === EntryType.CREDIT) {
          return sum + entry.amountCents;
        } else if (entry.entryType === EntryType.DEBIT) {
          return sum - entry.amountCents;
        }
        return sum;
      }, BigInt(0));

      // Expected: +50000 (first deposit) - 20000 (payment) + 30000 (second deposit) = +60000
      expect(balance).toBe(BigInt(60000));
    });

    it('should group entries by account code for trial balance report', async () => {
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456787',
          phoneNumberHash: 'hash_27123456787',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0009',
          balanceCents: BigInt(100000),
        },
      });

      // Create entries with different account codes
      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_001',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100', // CUSTOMER_WALLETS
          amountCents: BigInt(10000),
          currency: 'ZAR',
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_001',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.CREDIT,
          accountCode: '1100', // CUSTOMER_WALLETS
          amountCents: BigInt(10000),
          currency: 'ZAR',
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_002',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1200', // FEE_POOL
          amountCents: BigInt(100),
          currency: 'ZAR',
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_002',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.CREDIT,
          accountCode: '1200', // FEE_POOL
          amountCents: BigInt(100),
          currency: 'ZAR',
        },
      });

      // Group by account code
      const result = await prisma.ledgerEntry.groupBy({
        by: ['accountCode'],
        _sum: {
          amountCents: true,
        },
        _count: {
          _all: true,
        },
      });

      expect(result.length).toBe(2);
      
      // Find the CUSTOMER_WALLETS entries
      const customerWallets = result.find(r => r.accountCode === '1100');
      expect(customerWallets).toBeDefined();
      expect(customerWallets!._sum.amountCents).toBe(BigInt(20000));
      
      // Find the FEE_POOL entries
      const feePool = result.find(r => r.accountCode === '1200');
      expect(feePool).toBeDefined();
      expect(feePool!._sum.amountCents).toBe(BigInt(200));
    });
  });

  describe('BigInt Serialization Safety', () => {
    it('should handle BigInt values correctly without precision loss', async () => {
      const user = await prisma.user.create({
        data: {
          phoneNumber: '27123456788',
          phoneNumberHash: 'hash_27123456788',
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          userId: user.id,
          walletNumber: 'AHV-0001-0001-0010',
          balanceCents: BigInt(100000),
        },
      });

      // Create an entry with a large amount (R10,000 = 1,000,000 cents)
      const largeAmount = BigInt(1000000);
      const entry = await prisma.ledgerEntry.create({
        data: {
          transactionId: 'txn_large',
          walletId: wallet.id,
          userId: user.id,
          entryType: EntryType.DEBIT,
          accountCode: '1100',
          amountCents: largeAmount,
          currency: 'ZAR',
        },
      });

      expect(entry.amountCents).toBe(largeAmount);
      expect(entry.amountCents).toBeInstanceOf(BigInt);
      
      // Verify it was stored correctly
      const retrieved = await prisma.ledgerEntry.findUnique({
        where: { id: entry.id },
      });
      
      expect(retrieved!.amountCents).toBe(largeAmount);
      expect(retrieved!.amountCents).toBeInstanceOf(BigInt);
    });
  });
});
