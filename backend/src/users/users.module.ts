import { Module } from '@nestjs/common';

import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma.service.js';

import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [
    RedisModule,
  ],
  controllers: [
    UsersController,
  ],
  providers: [
    UsersService,
    PrismaService,
  ],
  exports: [
    UsersService,
  ],
})
export class UsersModule {}