/**
 * Notification Constants
 * Configuration for notification queue service
 */

export type NotificationType = 'SMS' | 'EMAIL' | 'PUSH' | 'WEBHOOK';
export type NotificationPriority = 1 | 2 | 3 | 4;
export type NotificationStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'RETRYING' | 'EXPIRED';
export type NotificationChannel = 'TRANSACTION' | 'SECURITY' | 'MARKETING' | 'COMPLIANCE' | 'SYSTEM';

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

export const NOTIFICATION_TYPE_LABELS = {
  SMS: 'SMS',
  EMAIL: 'Email',
  PUSH: 'Push Notification',
  WEBHOOK: 'Webhook',
} as const;

export const NOTIFICATION_CHANNEL_LABELS = {
  TRANSACTION: 'Transaction',
  SECURITY: 'Security',
  MARKETING: 'Marketing',
  COMPLIANCE: 'Compliance',
  SYSTEM: 'System',
} as const;

export default { NOTIFICATION_CONFIG, NOTIFICATION_TYPE_LABELS, NOTIFICATION_CHANNEL_LABELS };
