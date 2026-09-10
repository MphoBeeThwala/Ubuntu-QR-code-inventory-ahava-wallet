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
    // "MLRO_TEAM" is a routing label, not a real user — notification-service
    // has no lookup for it, so the actual destination address has to travel
    // with the job itself. Without MLRO_ALERT_EMAIL set, the EMAIL dispatch
    // case in notification-service's worker rejects the job outright
    // ("emailAddress required for EMAIL channel"), so this compliance-
    // critical alert would silently never reach anyone — logged loudly here
    // so that's caught at alert time, not discovered later by someone
    // reading failed notification rows.
    const emailAddress = process.env.MLRO_ALERT_EMAIL;
    if (!emailAddress) {
      console.error(
        "[mlro-notifier] MLRO_ALERT_EMAIL is not set — AML flag alert for flag",
        flag.id,
        "will be queued but will fail to dispatch. Set MLRO_ALERT_EMAIL to the compliance team's distribution address.",
      );
    }

    // Send email/slack notification via the notification service
    await this.queue.add(
      "mlro-alert",
      {
        channel: "EMAIL",
        userId: "MLRO_TEAM", // Special routing key
        emailAddress,
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
