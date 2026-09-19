import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import { PrismaService } from '../prisma.service.js';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      notification: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    service = new NotificationsService(mockPrisma as unknown as PrismaService);
  });

  describe('createNotification', () => {
    it('should create notification in database and format data as JSON string', async () => {
      const createdItem = {
        id: 'notif-1',
        userId: 'user-1',
        type: 'FRIEND_REQUEST',
        title: 'New Friend Request',
        body: 'Alice sent a request',
        data: '{"senderId":"user-2"}',
      };
      mockPrisma.notification.create.mockResolvedValue(createdItem);

      const result = await service.createNotification({
        userId: 'user-1',
        type: 'FRIEND_REQUEST',
        title: 'New Friend Request',
        body: 'Alice sent a request',
        data: { senderId: 'user-2' },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'FRIEND_REQUEST',
          title: 'New Friend Request',
          body: 'Alice sent a request',
          data: JSON.stringify({ senderId: 'user-2' }),
        },
      });
      expect(result).toEqual(createdItem);
    });

    it('should invoke registered notificationEmitter when present', async () => {
      const emitter = vi.fn();
      service.registerNotificationEmitter(emitter);

      const createdItem = { id: 'notif-1', userId: 'user-1' };
      mockPrisma.notification.create.mockResolvedValue(createdItem);

      await service.createNotification({
        userId: 'user-1',
        type: 'NEW_MESSAGE',
        title: 'New Message',
        body: 'Hello',
      });

      expect(emitter).toHaveBeenCalledWith('user-1', createdItem);
    });

    it('should not throw if notificationEmitter throws an error', async () => {
      const brokenEmitter = vi.fn().mockImplementation(() => {
        throw new Error('Socket emit error');
      });
      service.registerNotificationEmitter(brokenEmitter);

      mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' });

      await expect(
        service.createNotification({
          userId: 'user-1',
          type: 'NEW_MESSAGE',
          title: 'Title',
          body: 'Body',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('getNotifications', () => {
    it('should query top 50 notifications ordered descending by createdAt', async () => {
      const list = [{ id: 'n1' }, { id: 'n2' }];
      mockPrisma.notification.findMany.mockResolvedValue(list);

      const result = await service.getNotifications('user-1');
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      expect(result).toBe(list);
    });
  });

  describe('getUnreadCount', () => {
    it('should query prisma count when cache is empty and cache the result', async () => {
      mockPrisma.notification.count.mockResolvedValue(5);

      const count1 = await service.getUnreadCount('user-1');
      expect(count1).toBe(5);
      expect(mockPrisma.notification.count).toHaveBeenCalledTimes(1);

      // Subsequent call should hit cache without calling prisma.count again
      const count2 = await service.getUnreadCount('user-1');
      expect(count2).toBe(5);
      expect(mockPrisma.notification.count).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate simultaneous in-flight requests', async () => {
      let resolveQuery: (val: number) => void;
      mockPrisma.notification.count.mockImplementation(
        () => new Promise((resolve) => { resolveQuery = resolve; }),
      );

      const p1 = service.getUnreadCount('user-simultaneous');
      const p2 = service.getUnreadCount('user-simultaneous');

      resolveQuery!(3);

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBe(3);
      expect(res2).toBe(3);
      expect(mockPrisma.notification.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('markAsRead', () => {
    it('should update unread notification and emit to notificationReadEmitter', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.notification.count.mockResolvedValue(2);

      const readEmitter = vi.fn();
      service.registerNotificationReadEmitter(readEmitter);

      const result = await service.markAsRead('notif-100', 'user-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-100', userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
      expect(readEmitter).toHaveBeenCalledWith('user-1', {
        readIds: ['notif-100'],
        unreadCount: 2,
      });
      expect(result).toEqual({ success: true, count: 2, affected: 1 });
    });
  });

  describe('markNotificationsAsRead', () => {
    it('should short-circuit and return zero affected if IDs array is empty', async () => {
      mockPrisma.notification.count.mockResolvedValue(4);
      const result = await service.markNotificationsAsRead('user-1', []);
      expect(result).toEqual({ success: true, count: 4, affected: 0, readIds: [] });
      expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled();
    });

    it('should bulk update valid string IDs and emit read sync', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.notification.count.mockResolvedValue(1);

      const readEmitter = vi.fn();
      service.registerNotificationReadEmitter(readEmitter);

      const result = await service.markNotificationsAsRead('user-1', ['n1', 'n2', '', '  ']);

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          id: { in: ['n1', 'n2'] },
          isRead: false,
        },
        data: { isRead: true },
      });
      expect(readEmitter).toHaveBeenCalledWith('user-1', {
        readIds: ['n1', 'n2'],
        unreadCount: 1,
      });
      expect(result.affected).toBe(2);
      expect(result.readIds).toEqual(['n1', 'n2']);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read and emit count 0', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 7 });

      const readEmitter = vi.fn();
      service.registerNotificationReadEmitter(readEmitter);

      const result = await service.markAllAsRead('user-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
      expect(readEmitter).toHaveBeenCalledWith('user-1', {
        readIds: undefined,
        unreadCount: 0,
      });
      expect(result).toEqual({ success: true, count: 0, affected: 7 });
    });
  });
});
