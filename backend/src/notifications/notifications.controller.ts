import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get(':userId')
  async getNotifications(@Param('userId') userId: string) {
    return this.notificationsService.getNotifications(userId);
  }

  @Get(':userId/unread-count')
  async getUnreadCount(@Param('userId') userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
  }

  @Put(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.notificationsService.markAsRead(id, body.userId);
  }

  @Put('user/:userId/read-bulk')
  async markBulkAsRead(
    @Param('userId') userId: string,
    @Body() body: { notificationIds: string[] },
  ) {
    return this.notificationsService.markNotificationsAsRead(
      userId,
      body?.notificationIds || [],
    );
  }

  @Put('user/:userId/read-all')
  async markAllAsRead(@Param('userId') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }
}
