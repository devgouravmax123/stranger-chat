import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { PrismaService } from './prisma.service.js';

import { ChatGateway } from './chat/chat.gateway.js';

import { UsersModule } from './users/users.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { RedisModule } from './redis/redis.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { GeminiModule } from './gemini/gemini.module.js';

@Module({
  imports: [
    RedisModule,
    UsersModule,
    FriendsModule,
    NotificationsModule,
    GeminiModule,
  ],
  controllers: [
    AppController,
  ],
  providers: [
    AppService,
    PrismaService,
    ChatGateway,
  ],
})
export class AppModule {}