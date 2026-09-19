import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';

import { CreateMessageDto } from './dto/create-message.dto.js';

import { RedisService } from './redis/redis.service.js';

@Controller()
export class AppController {
  constructor(private readonly redis: RedisService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      message: 'Stranger Chat backend is running',
      redisConnected: this.redis.getIsConnected(),
    };
  }

  @Post('messages')
  createMessage(@Body() createMessageDto: CreateMessageDto) {
    return {
      message: createMessageDto.text,
    };
  }
}