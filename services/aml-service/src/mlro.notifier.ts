import { AmlFlag } from "@prisma/client";
import { Queue } from "bullmq";
import { QUEUE_NAMES, getRedisConnectionConfig } from "@ahava/shared-events";

export class MlroNotifier {
  private queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.NOTIFICATION_QUEUED, {
      connection: getRedisConnectionConfig(),
    });
  }

  async notifyFlag(flag: AmlFlag): Promise<void> {
    // Send email/slack notification via the notification service
    await this.queue.add(
      "mlro-alert",
      {
        channel: "EMAIL",
        userId: "MLRO_TEAM", // Special routing key
        title: `URGENT: AML Flag [${flag.severity}] - ${flag.flagType}`,
        body: `A new AML flag requires immediate attention.\n\nType: ${flag.flagType}\nSeverity: ${flag.severity}\nScore: ${flag.riskScore}\nDetails: ${flag.description}\n\nReview in Agent Portal.`,
        metadata: {
          flagId: flag.id,
          walletId: flag.walletId,
          transactionId: flag.transactionId,
        },
      },
      {
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    console.log("MLRO notification queued for flag", flag.id);
  }
}
