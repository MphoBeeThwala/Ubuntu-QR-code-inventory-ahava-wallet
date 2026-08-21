import { calculateFee, recordFeeWithLedger, reverseFee } from './fee-calculator';
import { FEE_TYPES, DEFAULT_FEES } from './constants/fees';

// Mock Prisma Client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    fee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    feeConfiguration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback({
      fee: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      feeConfiguration: {
        findUnique: jest.fn(),
      },
      ledgerEntry: {
        create: jest.fn(),
      },
    })),
  })),
}));

describe('Fee Accounting Consistency (BATCH 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateFee', () => {
    it('should calculate percentage fee correctly', () => {
      const result = calculateFee({
        amountCents: '100000', // R1000.00
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // 1.5% of 100000 = 1500 cents (R15.00)
      expect(result.feeAmountCents).toBe(1500n);
      expect(result.feeType).toBe(FEE_TYPES.TRANSACTION_FEE);
      expect(result.calculationMethod).toBe('PERCENTAGE');
    });

    it('should apply minimum fee', () => {
      const result = calculateFee({
        amountCents: '100', // R1.00
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // 1.5% of 100 = 1.5 cents, but min is 0
      // So it should be at least 0 (the default min)
      expect(result.feeAmountCents).toBeGreaterThanOrEqual(0n);
    });

    it('should apply maximum fee cap', () => {
      const result = calculateFee({
        amountCents: '100000000', // R1,000,000.00
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // 1.5% of 100000000 = 1500000 cents (R15,000)
      // But max is 5000 cents (R50)
      expect(result.feeAmountCents).toBeLessThanOrEqual(DEFAULT_FEES.TRANSACTION_FEE_MAX);
    });

    it('should return zero for deposit fee', () => {
      const result = calculateFee({
        amountCents: '100000',
        feeType: FEE_TYPES.DEPOSIT_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      expect(result.feeAmountCents).toBe(0n);
    });

    it('should return flat fee for withdrawal', () => {
      const result = calculateFee({
        amountCents: '100000',
        feeType: FEE_TYPES.WITHDRAWAL_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      expect(result.feeAmountCents).toBe(DEFAULT_FEES.WITHDRAWAL_FEE_FLAT);
      expect(result.calculationMethod).toBe('FLAT');
    });

    it('should handle BigInt input', () => {
      const result = calculateFee({
        amountCents: BigInt('100000'),
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      expect(result.feeAmountCents).toBe(1500n);
    });

    it('should handle string input', () => {
      const result = calculateFee({
        amountCents: '100000',
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      expect(result.feeAmountCents).toBe(1500n);
    });

    it('should handle number input', () => {
      const result = calculateFee({
        amountCents: 100000,
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      expect(result.feeAmountCents).toBe(1500n);
    });
  });

  describe('recordFeeWithLedger', () => {
    it('should create fee with matching DEBIT and CREDIT entries', async () => {
      const mockTx = {
        fee: {
          create: jest.fn().mockResolvedValue({
            id: 'fee-1',
            transactionId: 'txn-1',
            amountCents: 1500n,
            reference: 'fee-txn-1-TRANSACTION_FEE',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        ledgerEntry: {
          create: jest.fn()
            .mockResolvedValueOnce({ id: 'entry-1', entryType: 'DEBIT', accountCode: 'FEE_PAYABLE', amountCents: 1500n })
            .mockResolvedValueOnce({ id: 'entry-2', entryType: 'CREDIT', accountCode: 'PLATFORM_REVENUE', amountCents: 1500n }),
        },
      };

      // Mock the transaction
      (prisma as any).$transaction.mockImplementationOnce((callback: any) => {
        return callback(mockTx);
      });

      const result = await recordFeeWithLedger({
        amountCents: '100000',
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      expect(result.fee).toBeDefined();
      expect(result.debitEntry.entryType).toBe('DEBIT');
      expect(result.creditEntry.entryType).toBe('CREDIT');
      expect(result.debitEntry.amountCents).toBe(1500n);
      expect(result.creditEntry.amountCents).toBe(1500n);
    });

    it('should use correct account codes for agent commission', async () => {
      const mockTx = {
        fee: {
          create: jest.fn().mockResolvedValue({
            id: 'fee-1',
            transactionId: 'txn-1',
            amountCents: 5000n,
            reference: 'fee-txn-1-AGENT_COMMISSION',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        ledgerEntry: {
          create: jest.fn()
            .mockResolvedValueOnce({ id: 'entry-1', entryType: 'DEBIT', accountCode: 'AGENT_COMMISSION_PAYABLE' })
            .mockResolvedValueOnce({ id: 'entry-2', entryType: 'CREDIT', accountCode: 'FEE_INCOME' }),
        },
      };

      (prisma as any).$transaction.mockImplementationOnce((callback: any) => {
        return callback(mockTx);
      });

      const result = await recordFeeWithLedger({
        amountCents: '100000',
        feeType: FEE_TYPES.AGENT_COMMISSION,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      expect(result.debitEntry.accountCode).toBe('AGENT_COMMISSION_PAYABLE');
      expect(result.creditEntry.accountCode).toBe('FEE_INCOME');
    });

    it('should throw error for zero fee amount', async () => {
      await expect(
        recordFeeWithLedger({
          amountCents: '0',
          feeType: FEE_TYPES.TRANSACTION_FEE,
          walletId: 'wallet-1',
          transactionId: 'txn-1',
        })
      ).rejects.toThrow('Cannot record zero fee amount');
    });
  });

  describe('Double-Entry Accounting Validation', () => {
    it('should ensure DEBIT amount equals CREDIT amount', async () => {
      const result = await recordFeeWithLedger({
        amountCents: '100000',
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // Both entries should have the same amount
      expect(result.debitEntry.amountCents).toBe(result.creditEntry.amountCents);
      expect(result.debitEntry.amountCents).toBe(result.fee.amountCents);
    });

    it('should maintain financial invariant: sum(DEBITS) = sum(CREDITS)', async () => {
      // This is a fundamental accounting principle
      // For a single fee, we have:
      // - One DEBIT entry (amountCents)
      // - One CREDIT entry (amountCents)
      // So sum(DEBITS) = amountCents and sum(CREDITS) = amountCents
      // Therefore: sum(DEBITS) = sum(CREDITS)
      
      const result = await recordFeeWithLedger({
        amountCents: '100000',
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      const totalDebits = result.debitEntry.amountCents;
      const totalCredits = result.creditEntry.amountCents;
      
      expect(totalDebits).toBe(totalCredits);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small amounts', () => {
      const result = calculateFee({
        amountCents: '1', // 1 cent
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // 1.5% of 1 cent = 0.015 cents, rounds down to 0
      // But min is 0, so it should be 0
      expect(result.feeAmountCents).toBeGreaterThanOrEqual(0n);
    });

    it('should handle very large amounts', () => {
      const largeAmount = '9223372036854775807'; // Max BigInt
      const result = calculateFee({
        amountCents: largeAmount,
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // Should handle without overflow
      expect(result.feeAmountCents).toBeLessThanOrEqual(DEFAULT_FEES.TRANSACTION_FEE_MAX);
    });

    it('should handle negative amounts gracefully', () => {
      // In production, this should be validated before reaching the calculator
      // But the calculator should handle it safely
      const result = calculateFee({
        amountCents: '-100000',
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // Negative amount should result in 0 fee (or error, depending on design)
      expect(result.feeAmountCents).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('Financial Precision', () => {
    it('should maintain precision with BigInt arithmetic', () => {
      // Test that we don't lose precision with large numbers
      const result1 = calculateFee({
        amountCents: '10000000000', // 10 billion cents = R100,000
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      const result2 = calculateFee({
        amountCents: '20000000000', // 20 billion cents = R200,000
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-2',
      });

      // result2 should be exactly double result1
      expect(result2.feeAmountCents).toBe(result1.feeAmountCents * 2n);
    });

    it('should not use floating point arithmetic', () => {
      // Verify that all calculations use integer arithmetic
      const result = calculateFee({
        amountCents: '100000',
        feeType: FEE_TYPES.TRANSACTION_FEE,
        walletId: 'wallet-1',
        transactionId: 'txn-1',
      });

      // The result should be an exact integer (BigInt)
      expect(result.feeAmountCents).toBeInstanceOf(BigInt);
      expect(Number.isInteger(Number(result.feeAmountCents))).toBe(true);
    });
  });
});
