// Minimal AML queue stub for payment-service.
// In production, this would enqueue AML checks and sanctions screenings.

export class AmlQueue {
  async addPostPaymentCheck(_payload: {
    transactionId: string;
    senderWalletId: string;
    recipientWalletId: string;
    amountCents: number;
    deviceId?: string;
  }): Promise<void> {
    // No-op for local development.
    return;
  }

  async addSanctionsCheck(_payload: {
    senderUserId: string;
    recipientUserId: string;
    correlationId: string;
    blockOnMatch: boolean;
  }): Promise<void> {
    // No-op for local development.
    return;
  }
}
