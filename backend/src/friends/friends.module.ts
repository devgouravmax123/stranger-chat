import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';

import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  controllers: [FriendsController],

  providers: [
    FriendsService,
    PrismaService,
  ],

  exports: [FriendsService],
})
export class FriendsModule {}