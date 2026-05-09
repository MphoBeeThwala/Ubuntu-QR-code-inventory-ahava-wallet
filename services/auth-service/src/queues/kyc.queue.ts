import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";

export class KycQueue {
  private queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.KYC_DOCUMENT_UPLOADED, {
      connection: getRedisConnectionConfig(),
    });
  }

  async addSelfieProcessing(payload: {
    userId: string;
    selfieBase64: string;
  }): Promise<void> {
    await this.queue.add("process-selfie", payload, {
      removeOnComplete: true,
      removeOnFail: false,
    });
    console.log("KYC selfie processing enqueued", payload.userId);
  }

  async addIdVerification(payload: {
    userId: string;
    idNumber: string;
    idType: string;
  }): Promise<void> {
    await this.queue.add("verify-id", payload, {
      removeOnComplete: true,
      removeOnFail: false,
    });
    console.log("KYC ID verification enqueued", payload.userId);
  }
}
