import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@ahava/shared-events";

export class KycQueue {
  private queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.KYC_DOCUMENT_UPLOADED, {
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
      },
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
