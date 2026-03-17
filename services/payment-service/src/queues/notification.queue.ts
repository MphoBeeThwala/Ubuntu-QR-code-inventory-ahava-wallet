// Minimal notification queue stub for payment-service.
// In production, this would enqueue messages for push/SMS/email.

export class NotificationQueue {
  async addPaymentReceived(_payload: {
    userId: string;
    senderName: string;
    amountFormatted: string;
    reference?: string;
    newBalanceFormatted: string;
  }): Promise<void> {
    // No-op for local development.
    return;
  }

  async addPaymentSent(_payload: {
    userId: string;
    recipientName: string;
    amountFormatted: string;
    receipt: unknown;
  }): Promise<void> {
    // No-op for local development.
    return;
  }
}
