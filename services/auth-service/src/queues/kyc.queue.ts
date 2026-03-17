// Minimal stub for KYC queue producer. In production, this would push jobs to BullMQ or another queue.

export class KycQueue {
  async addSelfieProcessing(payload: { userId: string; selfieBase64: string }): Promise<void> {
    // TODO: Enqueue selfie processing job
    console.log('KYC selfie processing enqueued', payload.userId);
  }

  async addIdVerification(payload: { userId: string; idNumber: string; idType: string }): Promise<void> {
    // TODO: Enqueue ID verification job
    console.log('KYC ID verification enqueued', payload.userId);
  }
}
