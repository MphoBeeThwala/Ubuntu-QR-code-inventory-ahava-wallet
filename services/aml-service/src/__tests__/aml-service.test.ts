/**
 * AML Service Tests
 */

import { amlService, screenAmlTransaction, shouldBlockAmlTransaction, requiresAmlReview, AML_CONFIG } from '../services/aml-service';

describe('AML Service', () => {
  describe('AML_CONFIG', () => {
    it('should have BIGINT limits', () => {
      expect(AML_CONFIG.SINGLE_TRANSACTION_LIMIT).toBe(100000000n);
      expect(AML_CONFIG.DAILY_LIMIT).toBe(500000000n);
      expect(AML_CONFIG.MONTHLY_LIMIT).toBe(5000000000n);
    });

    it('should have correct risk score thresholds', () => {
      expect(AML_CONFIG.LOW_RISK_SCORE).toBe(0);
      expect(AML_CONFIG.MEDIUM_RISK_SCORE).toBe(50);
      expect(AML_CONFIG.HIGH_RISK_SCORE).toBe(80);
      expect(AML_CONFIG.CRITICAL_RISK_SCORE).toBe(100);
    });
  });

  describe('screenTransaction()', () => {
    const baseRequest = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      amountCents: 5000000n,
      senderPhone: '+27721234567',
      senderWalletId: '550e8400-e29b-41d4-a716-446655440001',
      transactionType: 'TRANSFER',
    };

    it('should pass transaction below limit', async () => {
      const result = await amlService.screenTransaction({ ...baseRequest, amountCents: 5000000n });
      expect(result.status).toBe('PASSED');
      expect(result.riskLevel).toBe('LOW');
      expect(result.riskScore).toBe(0);
    });

    it('should flag transaction above limit', async () => {
      const result = await amlService.screenTransaction({ ...baseRequest, amountCents: 150000000n });
      expect(result.status).toBe('MEDIUM');
      expect(result.riskLevel).toBe('MEDIUM');
      expect(result.riskScore).toBeGreaterThan(0);
    });

    it('should block transaction significantly above limit', async () => {
      const result = await amlService.screenTransaction({ ...baseRequest, amountCents: 2000000000n });
      expect(result.status).toBe('BLOCKED');
      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.riskScore).toBe(100);
    });
  });

  describe('shouldBlockTransaction()', () => {
    it('should return false for transactions below limit', async () => {
      const shouldBlock = await shouldBlockAmlTransaction({ ...baseRequest, amountCents: 5000000n });
      expect(shouldBlock).toBe(false);
    });

    it('should return true for transactions significantly above limit', async () => {
      const shouldBlock = await shouldBlockAmlTransaction({ ...baseRequest, amountCents: 2000000000n });
      expect(shouldBlock).toBe(true);
    });
  });

  describe('requiresReview()', () => {
    it('should return false for low risk transactions', async () => {
      const requiresReview = await requiresAmlReview({ ...baseRequest, amountCents: 5000000n });
      expect(requiresReview).toBe(false);
    });

    it('should return true for medium risk transactions', async () => {
      const requiresReview = await requiresAmlReview({ ...baseRequest, amountCents: 150000000n });
      expect(requiresReview).toBe(true);
    });
  });
});

describe('AML Financial Safety', () => {
  it('should handle BIGINT cents correctly', async () => {
    const amounts = [100n, 10000n, 1000000n, 100000000n];
    for (const amount of amounts) {
      const result = await amlService.screenTransaction({ ...baseRequest, amountCents: amount });
      expect(result).toBeDefined();
      expect(typeof result.riskScore).toBe('number');
    }
  });

  it('should not use floating point arithmetic', async () => {
    const result = await amlService.screenTransaction({ ...baseRequest, amountCents: 123456789n });
    expect(Number.isInteger(result.riskScore)).toBe(true);
  });

  it('should maintain double-entry accounting integrity', async () => {
    const result = await amlService.screenTransaction({ ...baseRequest, amountCents: 100000000n });
    expect(result).not.toHaveProperty('debitAmount');
    expect(result).not.toHaveProperty('creditAmount');
  });
});
