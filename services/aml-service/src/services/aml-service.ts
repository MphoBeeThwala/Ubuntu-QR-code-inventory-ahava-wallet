/**
 * AML (Anti-Money Laundering) Service
 * Implements AML screening and compliance for the Ubuntu Pay platform
 */

import { z } from 'zod';

export const AML_CONFIG = {
  SINGLE_TRANSACTION_LIMIT: 100000000n, // R100,000 in cents
  DAILY_LIMIT: 500000000n, // R500,000 in cents
  MONTHLY_LIMIT: 5000000000n, // R5,000,000 in cents
  MAX_TRANSACTIONS_PER_HOUR: 10,
  MAX_TRANSACTIONS_PER_DAY: 50,
  LOW_RISK_SCORE: 0,
  MEDIUM_RISK_SCORE: 50,
  HIGH_RISK_SCORE: 80,
  CRITICAL_RISK_SCORE: 100,
  ENABLE_WATCHLIST_SCREENING: true,
  ENABLE_SANCTIONS_SCREENING: true,
  ENABLE_VELOCITY_CHECKS: true,
  ENABLE_AMOUNT_CHECKS: true,
  ENABLE_GEOGRAPHIC_CHECKS: true,
} as const;

export type AmlRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AmlCheckType = 'WATCHLIST' | 'SANCTIONS' | 'VELOCITY' | 'AMOUNT' | 'GEOGRAPHIC' | 'BEHAVIORAL';
export type AmlStatus = 'PENDING' | 'PASSED' | 'FLAGGED' | 'BLOCKED' | 'REVIEW_REQUIRED' | 'FALSE_POSITIVE';

export const AmlCheckRequestSchema = z.object({
  userId: z.string().uuid(),
  transactionId: z.string().uuid().optional(),
  amountCents: z.bigint().positive(),
  currency: z.string().default('ZAR'),
  senderPhone: z.string(),
  receiverPhone: z.string().optional(),
  senderWalletId: z.string().uuid(),
  receiverWalletId: z.string().uuid().optional(),
  transactionType: z.string(),
  ipAddress: z.string().optional(),
  deviceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type AmlCheckRequest = z.infer<typeof AmlCheckRequestSchema>;

class AmlService {
  async screenTransaction(request: AmlCheckRequest) {
    const checkId = crypto.randomUUID();
    const now = new Date();
    let riskScore = 0;
    let riskLevel: AmlRiskLevel = 'LOW';
    let status: AmlStatus = 'PASSED';
    const flags = [];
    const recommendations = [];
    const checksPerformed: AmlCheckType[] = [];

    if (AML_CONFIG.ENABLE_AMOUNT_CHECKS) {
      checksPerformed.push('AMOUNT');
      const amount = Number(request.amountCents);
      if (amount > Number(AML_CONFIG.SINGLE_TRANSACTION_LIMIT)) {
        const ratio = amount / Number(AML_CONFIG.SINGLE_TRANSACTION_LIMIT);
        if (ratio >= 10) {
          flags.push({ checkType: 'AMOUNT', description: 'Transaction exceeds limit by 10x', severity: 'CRITICAL' });
          riskScore += 40;
        } else if (ratio >= 5) {
          flags.push({ checkType: 'AMOUNT', description: 'Transaction exceeds limit by 5x', severity: 'HIGH' });
          riskScore += 30;
        } else if (ratio >= 2) {
          flags.push({ checkType: 'AMOUNT', description: 'Transaction exceeds limit', severity: 'MEDIUM' });
          riskScore += 20;
        }
      }
    }

    riskScore = Math.min(riskScore, 100);
    riskLevel = this.determineRiskLevel(riskScore);
    status = this.determineStatus(riskLevel, flags);

    if (flags.length > 0) {
      recommendations.push('Transaction requires manual review');
      if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
        recommendations.push('Consider blocking transaction');
        recommendations.push('Notify compliance team');
      }
    }

    return {
      checkId,
      userId: request.userId,
      transactionId: request.transactionId,
      riskScore,
      riskLevel,
      status,
      checksPerformed,
      flags,
      recommendations,
      createdAt: now,
      updatedAt: now,
    };
  }

  private determineRiskLevel(score: number): AmlRiskLevel {
    if (score >= AML_CONFIG.CRITICAL_RISK_SCORE) return 'CRITICAL';
    if (score >= AML_CONFIG.HIGH_RISK_SCORE) return 'HIGH';
    if (score >= AML_CONFIG.MEDIUM_RISK_SCORE) return 'MEDIUM';
    return 'LOW';
  }

  private determineStatus(riskLevel: AmlRiskLevel, flags: any[]): AmlStatus {
    if (flags.length === 0) return 'PASSED';
    if (riskLevel === 'CRITICAL') return 'BLOCKED';
    if (riskLevel === 'HIGH') return 'REVIEW_REQUIRED';
    if (riskLevel === 'MEDIUM') return 'FLAGGED';
    return 'REVIEW_REQUIRED';
  }

  async shouldBlockTransaction(request: AmlCheckRequest): Promise<boolean> {
    const result = await this.screenTransaction(request);
    return result.status === 'BLOCKED' || result.riskLevel === 'CRITICAL';
  }

  async requiresReview(request: AmlCheckRequest): Promise<boolean> {
    const result = await this.screenTransaction(request);
    return result.status === 'REVIEW_REQUIRED' || result.status === 'FLAGGED' || result.riskLevel === 'HIGH' || result.riskLevel === 'MEDIUM';
  }
}

export const amlService = new AmlService();

export function screenAmlTransaction(request: AmlCheckRequest) {
  return amlService.screenTransaction(request);
}

export function shouldBlockAmlTransaction(request: AmlCheckRequest) {
  return amlService.shouldBlockTransaction(request);
}

export function requiresAmlReview(request: AmlCheckRequest) {
  return amlService.requiresReview(request);
}

export default amlService;
