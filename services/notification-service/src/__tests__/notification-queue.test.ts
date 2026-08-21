/**
 * Notification Queue Service Tests
 */

import { notificationQueueService, enqueueNotification, getNotificationQueueStats, getNotification } from '../services/notification-queue';

describe('Notification Queue Service', () => {
  beforeEach(() => {
    notificationQueueService.clearQueue();
  });

  describe('enqueue()', () => {
    it('should enqueue notification with default priority', async () => {
      const notification = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        channel: 'TRANSACTION' as const,
        title: 'Test Notification',
        message: 'This is a test message',
      };

      const result = await notificationQueueService.enqueue(notification);

      expect(result.notificationId).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(result.priority).toBe(3);
    });

    it('should enqueue notification with custom priority', async () => {
      const notification = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'EMAIL' as const,
        priority: 1 as const,
        channel: 'SECURITY' as const,
        title: 'Urgent Security Alert',
        message: 'Security breach detected',
      };

      const result = await notificationQueueService.enqueue(notification);
      expect(result.priority).toBe(1);
    });

    it('should sort notifications by priority', async () => {
      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'EMAIL' as const,
        priority: 4 as const,
        channel: 'MARKETING' as const,
        title: 'Low Priority',
        message: 'Low priority message',
      });

      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        priority: 1 as const,
        channel: 'SECURITY' as const,
        title: 'High Priority',
        message: 'High priority message',
      });

      const queue = (notificationQueueService as any).queue;
      expect(queue[0].priority).toBe(1);
      expect(queue[1].priority).toBe(4);
    });
  });

  describe('getQueueStats()', () => {
    it('should return correct statistics', async () => {
      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        channel: 'TRANSACTION' as const,
        title: 'Test 1',
        message: 'Message 1',
      });

      const stats = notificationQueueService.getQueueStats();
      expect(stats.total).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });

  describe('getNotification()', () => {
    it('should return notification by ID', async () => {
      const { notificationId } = await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        channel: 'TRANSACTION' as const,
        title: 'Test Notification',
        message: 'Test message',
      });

      const notification = notificationQueueService.getNotification(notificationId);
      expect(notification).toBeDefined();
      expect(notification?.notificationId).toBe(notificationId);
    });

    it('should return undefined for non-existent notification', () => {
      const notification = notificationQueueService.getNotification('non-existent-id');
      expect(notification).toBeUndefined();
    });
  });

  describe('removeNotification()', () => {
    it('should remove notification from queue', async () => {
      const { notificationId } = await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        channel: 'TRANSACTION' as const,
        title: 'Test Notification',
        message: 'Test message',
      });

      const removed = notificationQueueService.removeNotification(notificationId);
      expect(removed).toBe(true);
      expect(notificationQueueService.getNotification(notificationId)).toBeUndefined();
    });
  });

  describe('clearQueue()', () => {
    it('should clear all notifications', async () => {
      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        channel: 'TRANSACTION' as const,
        title: 'Test 1',
        message: 'Message 1',
      });

      const count = notificationQueueService.clearQueue();
      expect(count).toBe(1);
      expect(notificationQueueService.getQueueStats().total).toBe(0);
    });
  });

  describe('getNotificationsByUser()', () => {
    it('should return notifications for specific user', async () => {
      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        channel: 'TRANSACTION' as const,
        title: 'User 1 Notification',
        message: 'Message for user 1',
      });

      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440001',
        type: 'EMAIL' as const,
        channel: 'SECURITY' as const,
        title: 'User 2 Notification',
        message: 'Message for user 2',
      });

      const user1Notifications = notificationQueueService.getNotificationsByUser('550e8400-e29b-41d4-a716-446655440000');
      expect(user1Notifications.length).toBe(1);
    });
  });

  describe('getNotificationsByType()', () => {
    it('should return notifications of specific type', async () => {
      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'SMS' as const,
        channel: 'TRANSACTION' as const,
        title: 'SMS Notification',
        message: 'SMS message',
      });

      await notificationQueueService.enqueue({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'EMAIL' as const,
        channel: 'TRANSACTION' as const,
        title: 'Email Notification',
        message: 'Email message',
      });

      const smsNotifications = notificationQueueService.getNotificationsByType('SMS');
      expect(smsNotifications.length).toBe(1);
    });
  });
});

describe('Notification Queue Financial Safety', () => {
  it('should handle notification data without affecting financial operations', async () => {
    const notification = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'SMS' as const,
      channel: 'TRANSACTION' as const,
      title: 'Transaction Confirmation',
      message: 'Your transaction was successful',
      data: { transactionId: '123', amount: '10000' },
    };

    const result = await notificationQueueService.enqueue(notification);
    expect(result).toBeDefined();
    expect(result.data.amount).toBe('10000');
  });

  it('should not perform financial calculations', async () => {
    const notification = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'EMAIL' as const,
      channel: 'COMPLIANCE' as const,
      title: 'Compliance Report',
      message: 'Daily report',
      data: { totalTransactions: 100, totalAmount: 5000000 },
    };

    const result = await notificationQueueService.enqueue(notification);
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('calculatedAmount');
  });

  it('should maintain data integrity for financial notifications', async () => {
    const originalAmount = '10000';
    const notification = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'PUSH' as const,
      channel: 'TRANSACTION' as const,
      title: 'Payment Received',
      message: 'You received a payment',
      data: { amount: originalAmount },
    };

    const result = await notificationQueueService.enqueue(notification);
    const retrieved = notificationQueueService.getNotification(result.notificationId);
    expect(retrieved?.data.amount).toBe(originalAmount);
  });
});
