import { Module } from '@nestjs/common';

import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

import { RedisModule } from '../redis/redis.module.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [
    RedisModule,
    MediaModule,
  ],
  controllers: [
    UsersController,
  ],
  providers: [
    UsersService,
  ],
  exports: [
    UsersService,
  ],
})
export class UsersModule {}