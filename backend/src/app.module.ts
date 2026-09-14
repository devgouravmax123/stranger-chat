import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { PrismaService } from './prisma.service.js';

import { ChatGateway } from './chat/chat.gateway.js';

import { UsersModule } from './users/users.module.js';
import { FriendsModule } from './friends/friends.module.js';

@Module({
  imports: [
    UsersModule,
    FriendsModule,
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