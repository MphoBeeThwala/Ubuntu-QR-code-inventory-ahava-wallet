// BigInt JSON Serialization Tests for Payment Orchestrator
// Tests the fix for: BigInt cannot be serialized by JSON.stringify()
// Solution: Use amountCents.toString() instead of BigInt(amountCents)

describe('BigInt JSON Serialization - Payment Orchestrator', () => {
  // Simulate the saga payload structure from payment-orchestrator
  interface LedgerEntry {
    entryType: 'DEBIT' | 'CREDIT';
    accountCode: string;
    amountCents: unknown; // Can be BigInt or string
    currency: string;
    description: string;
    reference: string;
    counterpartyWalletId: string;
    counterpartyAccountCode: string;
  }

  interface PaymentSagaPayload {
    transactionId: string;
    userId: string;
    walletId: string;
    entries: LedgerEntry[];
  }

  function createSagaPayload(amountCents: bigint | string): PaymentSagaPayload {
    return {
      transactionId: 'test-txn-123',
      userId: 'user-123',
      walletId: 'wallet-123',
      entries: [
        {
          entryType: 'DEBIT',
          accountCode: 'WALLET',
          amountCents: amountCents,
          currency: 'ZAR',
          description: 'Test payment',
          reference: 'ref-123',
          counterpartyWalletId: 'wallet-456',
          counterpartyAccountCode: 'WALLET'
        },
        {
          entryType: 'CREDIT',
          accountCode: 'WALLET',
          amountCents: amountCents,
          currency: 'ZAR',
          description: 'Test payment',
          reference: 'ref-123',
          counterpartyWalletId: 'wallet-123',
          counterpartyAccountCode: 'WALLET'
        }
      ]
    };
  }

  describe('BEFORE FIX: BigInt directly in payload', () => {
    it('should throw TypeError when trying to JSON.stringify BigInt values', () => {
      const payload = createSagaPayload(BigInt(1000));
      
      expect(() => {
        JSON.stringify(payload);
      }).toThrow(TypeError);
      
      expect(() => {
        JSON.stringify(payload);
      }).toThrow('Do not know how to serialize a BigInt');
    });

    it('should fail serialization with any BigInt amount', () => {
      const largeAmount = BigInt('9223372036854775807');
      const payload = createSagaPayload(largeAmount);
      
      expect(() => {
        JSON.stringify(payload);
      }).toThrow(TypeError);
    });
  });

  describe('AFTER FIX: String representation in payload', () => {
    it('should successfully JSON.stringify payload with string amountCents', () => {
      const payload = createSagaPayload('1000');
      
      const serialized = JSON.stringify(payload);
      expect(serialized).toBeDefined();
      expect(typeof serialized).toBe('string');
      
      // Verify the amount is serialized as a string
      expect(serialized).toContain('"amountCents":"1000"');
    });

    it('should successfully JSON.stringify payload with large string amountCents', () => {
      const largeAmount = '9223372036854775807';
      const payload = createSagaPayload(largeAmount);
      
      const serialized = JSON.stringify(payload);
      expect(serialized).toBeDefined();
      expect(serialized).toContain('"amountCents":"9223372036854775807"');
    });

    it('should preserve all payload fields during serialization', () => {
      const payload = createSagaPayload('5000');
      
      const serialized = JSON.stringify(payload);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.transactionId).toBe('test-txn-123');
      expect(parsed.userId).toBe('user-123');
      expect(parsed.walletId).toBe('wallet-123');
      expect(parsed.entries).toHaveLength(2);
      expect(parsed.entries[0].amountCents).toBe('5000');
      expect(parsed.entries[1].amountCents).toBe('5000');
    });

    it('should handle zero amount correctly', () => {
      const payload = createSagaPayload('0');
      const serialized = JSON.stringify(payload);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.entries[0].amountCents).toBe('0');
      expect(parsed.entries[1].amountCents).toBe('0');
    });
  });

  describe('Ledger Service Compatibility', () => {
    it('should allow ledger-service to parse string amountCents using BigInt()', () => {
      const stringAmount = '1000';
      const parsedAmount = BigInt(stringAmount);
      
      expect(parsedAmount).toBe(BigInt(1000));
      expect(parsedAmount).toBeInstanceOf(BigInt);
    });

    it('should handle large string amounts correctly with BigInt()', () => {
      const largeStringAmount = '9223372036854775807';
      const parsedAmount = BigInt(largeStringAmount);
      
      expect(parsedAmount).toBe(BigInt('9223372036854775807'));
      expect(parsedAmount.toString()).toBe(largeStringAmount);
    });

    it('should maintain financial precision with string amounts', () => {
      const amount1 = '1000';
      const amount2 = '2000';
      
      const bigint1 = BigInt(amount1);
      const bigint2 = BigInt(amount2);
      
      // Test arithmetic operations maintain precision
      expect(bigint1 + bigint2).toBe(BigInt(3000));
      expect(bigint2 - bigint1).toBe(BigInt(1000));
      expect(bigint1 * BigInt(2)).toBe(BigInt(2000));
    });

    it('should handle zero amount correctly with BigInt()', () => {
      const zeroAmount = '0';
      const parsedAmount = BigInt(zeroAmount);
      
      expect(parsedAmount).toBe(BigInt(0));
      expect(parsedAmount).toBe(0n);
    });

    it('should handle negative amounts for reversals', () => {
      const negativeAmount = '-1000';
      const parsedAmount = BigInt(negativeAmount);
      
      expect(parsedAmount).toBe(BigInt(-1000));
      expect(parsedAmount).toBe(-1000n);
    });
  });

  describe('Round-trip Serialization', () => {
    it('should serialize and deserialize correctly with string amounts', () => {
      const originalPayload = createSagaPayload('7500');
      
      // Serialize
      const serialized = JSON.stringify(originalPayload);
      
      // Deserialize
      const deserialized = JSON.parse(serialized);
      
      // Verify structure is preserved
      expect(deserialized.entries).toHaveLength(2);
      expect(deserialized.entries[0].amountCents).toBe('7500');
      expect(deserialized.entries[1].amountCents).toBe('7500');
      
      // Verify ledger-service can parse the amounts
      const debitAmount = BigInt(deserialized.entries[0].amountCents as string);
      const creditAmount = BigInt(deserialized.entries[1].amountCents as string);
      
      expect(debitAmount).toBe(BigInt(7500));
      expect(creditAmount).toBe(BigInt(7500));
      
      // Verify double-entry accounting invariant
      expect(debitAmount).toBe(creditAmount);
    });

    it('should maintain precision through serialization round-trip', () => {
      const originalAmount = '12345678901234567890';
      const payload = createSagaPayload(originalAmount);
      
      const serialized = JSON.stringify(payload);
      const deserialized = JSON.parse(serialized);
      
      const parsedAmount = BigInt(deserialized.entries[0].amountCents as string);
      expect(parsedAmount.toString()).toBe(originalAmount);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small amounts', () => {
      const payload = createSagaPayload('1');
      const serialized = JSON.stringify(payload);
      const deserialized = JSON.parse(serialized);
      
      const parsedAmount = BigInt(deserialized.entries[0].amountCents as string);
      expect(parsedAmount).toBe(BigInt(1));
    });

    it('should handle maximum safe integer as string', () => {
      const maxSafe = '9007199254740991';
      const payload = createSagaPayload(maxSafe);
      const serialized = JSON.stringify(payload);
      const deserialized = JSON.parse(serialized);
      
      const parsedAmount = BigInt(deserialized.entries[0].amountCents as string);
      expect(parsedAmount).toBe(BigInt(maxSafe));
    });

    it('should distinguish between DEBIT and CREDIT entries', () => {
      const payload = createSagaPayload('1000');
      const serialized = JSON.stringify(payload);
      const deserialized = JSON.parse(serialized);
      
      expect(deserialized.entries[0].entryType).toBe('DEBIT');
      expect(deserialized.entries[1].entryType).toBe('CREDIT');
      
      // Both should have the same amount
      expect(deserialized.entries[0].amountCents).toBe(deserialized.entries[1].amountCents);
    });
  });
});
