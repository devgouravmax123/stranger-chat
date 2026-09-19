import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

export interface CreateNotificationDto {
  userId: string;
  type: 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED' | 'NEW_MESSAGE';
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private notificationEmitter?: (userId: string, notification: any) => void;
  private notificationReadEmitter?: (
    userId: string,
    data: { readIds?: string[]; unreadCount: number },
  ) => void;

  private unreadCountCache = new Map<string, { count: number; expiresAt: number }>();
  private inFlightUnreadCount = new Map<string, Promise<number>>();

  constructor(private readonly prisma: PrismaService) {}

  registerNotificationEmitter(emitter: (userId: string, notification: any) => void) {
    this.notificationEmitter = emitter;
  }

  registerNotificationReadEmitter(
    emitter: (userId: string, data: { readIds?: string[]; unreadCount: number }) => void,
  ) {
    this.notificationReadEmitter = emitter;
  }

  private invalidateUnreadCount(userId: string) {
    this.unreadCountCache.delete(userId);
  }

  async createNotification(dto: CreateNotificationDto) {
    this.invalidateUnreadCount(dto.userId);
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        data: dto.data ? JSON.stringify(dto.data) : null,
      },
    });

    if (this.notificationEmitter) {
      try {
        this.notificationEmitter(dto.userId, notification);
      } catch (err) {
        console.warn('Failed to emit real-time notification:', err);
      }
    }

    return notification;
  }

  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUnreadCount(userId: string) {
    const now = Date.now();
    const cached = this.unreadCountCache.get(userId);
    if (cached && now < cached.expiresAt) {
      return cached.count;
    }

    const inFlight = this.inFlightUnreadCount.get(userId);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      try {
        const count = await this.prisma.notification.count({
          where: { userId, isRead: false },
        });
        this.unreadCountCache.set(userId, { count, expiresAt: Date.now() + 4000 });
        return count;
      } finally {
        this.inFlightUnreadCount.delete(userId);
      }
    })();

    this.inFlightUnreadCount.set(userId, promise);
    return promise;
  }

  async markAsRead(notificationId: string, userId: string) {
    this.invalidateUnreadCount(userId);
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, isRead: false },
      data: { isRead: true },
    });

    const unreadCount = await this.getUnreadCount(userId);

    if (this.notificationReadEmitter) {
      try {
        this.notificationReadEmitter(userId, {
          readIds: [notificationId],
          unreadCount,
        });
      } catch (err) {
        console.warn('Failed to emit real-time notification read sync:', err);
      }
    }

    return { success: true, count: unreadCount, affected: result.count };
  }

  async markNotificationsAsRead(userId: string, notificationIds: string[]) {
    if (!userId || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      const count = await this.getUnreadCount(userId);
      return { success: true, count, affected: 0, readIds: [] };
    }

    // Filter valid non-empty string IDs
    const validIds = notificationIds.filter(
      (id) => typeof id === 'string' && id.trim().length > 0,
    );

    if (validIds.length === 0) {
      const count = await this.getUnreadCount(userId);
      return { success: true, count, affected: 0, readIds: [] };
    }

    this.invalidateUnreadCount(userId);
    // Bulk update only notifications belonging to THIS user and currently unread
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        id: { in: validIds },
        isRead: false,
      },
      data: { isRead: true },
    });

    const unreadCount = await this.getUnreadCount(userId);

    if (this.notificationReadEmitter) {
      try {
        this.notificationReadEmitter(userId, {
          readIds: validIds,
          unreadCount,
        });
      } catch (err) {
        console.warn('Failed to emit real-time notification read sync:', err);
      }
    }

    return {
      success: true,
      count: unreadCount,
      affected: result.count,
      readIds: validIds,
    };
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    if (this.notificationReadEmitter) {
      try {
        this.notificationReadEmitter(userId, {
          readIds: undefined,
          unreadCount: 0,
        });
      } catch (err) {
        console.warn('Failed to emit real-time notification read sync:', err);
      }
    }

    return { success: true, count: 0, affected: result.count };
  }
}
