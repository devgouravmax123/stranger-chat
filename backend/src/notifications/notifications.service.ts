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

  constructor(private readonly prisma: PrismaService) {}

  registerNotificationEmitter(emitter: (userId: string, notification: any) => void) {
    this.notificationEmitter = emitter;
  }

  async createNotification(dto: CreateNotificationDto) {
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
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
