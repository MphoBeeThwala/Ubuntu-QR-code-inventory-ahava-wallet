/**
 * Notification Queue Service
 * Manages notification queues for the Ubuntu Pay platform
 */

import { z } from 'zod';

export const NOTIFICATION_CONFIG = {
  PRIORITY_CRITICAL: 1,
  PRIORITY_HIGH: 2,
  PRIORITY_MEDIUM: 3,
  PRIORITY_LOW: 4,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 5000,
  RETRY_BACKOFF_MULTIPLIER: 2,
  BATCH_SIZE: 100,
  PROCESSING_INTERVAL_MS: 10000,
  QUEUE_TIMEOUT_MS: 300000,
  NOTIFICATION_TIMEOUT_MS: 30000,
  ENABLE_SMS: true,
  ENABLE_EMAIL: true,
  ENABLE_PUSH: true,
  ENABLE_WEBHOOK: true,
} as const;

export type NotificationType = 'SMS' | 'EMAIL' | 'PUSH' | 'WEBHOOK';
export type NotificationPriority = 1 | 2 | 3 | 4;
export type NotificationStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'RETRYING' | 'EXPIRED';
export type NotificationChannel = 'TRANSACTION' | 'SECURITY' | 'MARKETING' | 'COMPLIANCE' | 'SYSTEM';

export const NotificationRequestSchema = z.object({
  notificationId: z.string().uuid().optional(),
  userId: z.string().uuid(),
  type: z.enum(['SMS', 'EMAIL', 'PUSH', 'WEBHOOK']),
  priority: z.enum([1, 2, 3, 4] as const).default(3),
  channel: z.enum(['TRANSACTION', 'SECURITY', 'MARKETING', 'COMPLIANCE', 'SYSTEM']),
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(1000),
  data: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).optional(),
  scheduledAt: z.date().optional(),
  expiresAt: z.date().optional(),
});

export type NotificationRequest = z.infer<typeof NotificationRequestSchema>;

interface QueuedNotification extends NotificationRequest {
  notificationId: string;
  status: NotificationStatus;
  retryCount: number;
  lastAttemptAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

class NotificationQueueService {
  private queue: QueuedNotification[] = [];
  private isProcessing = false;

  async enqueue(notification: NotificationRequest): Promise<QueuedNotification> {
    const queuedNotification: QueuedNotification = {
      ...notification,
      notificationId: notification.notificationId || crypto.randomUUID(),
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.queue.push(queuedNotification);
    this.queue.sort((a, b) => a.priority - b.priority);

    if (!this.isProcessing) {
      this.processQueue();
    }

    return queuedNotification;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, NOTIFICATION_CONFIG.BATCH_SIZE);

        await Promise.all(
          batch.map(async (notification) => {
            try {
              await this.processNotification(notification);
            } catch (error) {
              notification.status = 'FAILED';
              notification.retryCount++;
              notification.lastAttemptAt = new Date();
              notification.updatedAt = new Date();

              if (notification.retryCount < NOTIFICATION_CONFIG.MAX_RETRIES) {
                notification.status = 'RETRYING';
                this.queue.push(notification);
              }
            }
          })
        );

        this.queue = this.queue.slice(NOTIFICATION_CONFIG.BATCH_SIZE);
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_CONFIG.PROCESSING_INTERVAL_MS));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processNotification(notification: QueuedNotification): Promise<void> {
    notification.status = 'PROCESSING';
    notification.lastAttemptAt = new Date();
    notification.updatedAt = new Date();

    await new Promise(resolve => setTimeout(resolve, 100));

    switch (notification.type) {
      case 'SMS':
        await this.sendSms(notification);
        break;
      case 'EMAIL':
        await this.sendEmail(notification);
        break;
      case 'PUSH':
        await this.sendPush(notification);
        break;
      case 'WEBHOOK':
        await this.sendWebhook(notification);
        break;
    }

    notification.status = 'SENT';
    notification.updatedAt = new Date();
    notification.status = 'DELIVERED';
    notification.updatedAt = new Date();
  }

  private async sendSms(notification: QueuedNotification): Promise<void> {
    console.log('Sending SMS:', notification.notificationId, notification.message);
  }

  private async sendEmail(notification: QueuedNotification): Promise<void> {
    console.log('Sending Email:', notification.notificationId, notification.message);
  }

  private async sendPush(notification: QueuedNotification): Promise<void> {
    console.log('Sending Push:', notification.notificationId, notification.message);
  }

  private async sendWebhook(notification: QueuedNotification): Promise<void> {
    console.log('Sending Webhook:', notification.notificationId, notification.message);
  }

  getQueueStats() {
    const stats = {
      total: this.queue.length,
      pending: 0,
      processing: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      retrying: 0,
      expired: 0,
    };

    for (const notification of this.queue) {
      switch (notification.status) {
        case 'PENDING': stats.pending++; break;
        case 'PROCESSING': stats.processing++; break;
        case 'SENT': stats.sent++; break;
        case 'DELIVERED': stats.delivered++; break;
        case 'FAILED': stats.failed++; break;
        case 'RETRYING': stats.retrying++; break;
        case 'EXPIRED': stats.expired++; break;
      }
    }

    return stats;
  }

  getNotification(notificationId: string) {
    return this.queue.find(n => n.notificationId === notificationId);
  }

  removeNotification(notificationId: string): boolean {
    const index = this.queue.findIndex(n => n.notificationId === notificationId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  clearQueue(): number {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }

  getNotificationsByUser(userId: string) {
    return this.queue.filter(n => n.userId === userId);
  }

  getNotificationsByStatus(status: NotificationStatus) {
    return this.queue.filter(n => n.status === status);
  }

  getNotificationsByType(type: NotificationType) {
    return this.queue.filter(n => n.type === type);
  }

  getNotificationsByChannel(channel: NotificationChannel) {
    return this.queue.filter(n => n.channel === channel);
  }
}

export const notificationQueueService = new NotificationQueueService();

export function enqueueNotification(notification: NotificationRequest) {
  return notificationQueueService.enqueue(notification);
}

export function getNotificationQueueStats() {
  return notificationQueueService.getQueueStats();
}

export function getNotification(notificationId: string) {
  return notificationQueueService.getNotification(notificationId);
}

export default notificationQueueService;
