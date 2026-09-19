import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { PrismaModule } from './prisma/prisma.module.js';

import { ChatGateway } from './chat/chat.gateway.js';
import { MatchingService } from './chat/matching.service.js';

import { UsersModule } from './users/users.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { RedisModule } from './redis/redis.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { GeminiModule } from './gemini/gemini.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware.js';
import { GlobalRateLimitMiddleware } from './common/middleware/global-rate-limit.middleware.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
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
    MatchingService,
    ChatGateway,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SecurityHeadersMiddleware, GlobalRateLimitMiddleware)
      .forRoutes('*');
  }
}