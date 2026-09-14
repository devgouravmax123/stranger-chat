import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';

import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';
import { FriendsGateway } from './friends.gateway.js';

@Module({
  controllers: [FriendsController],

  providers: [
    FriendsService,
    FriendsGateway,
    PrismaService,
  ],

  exports: [FriendsService],
})
export class FriendsModule {}