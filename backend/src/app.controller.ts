import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';

import { CreateMessageDto } from './dto/create-message.dto.js';

@Controller()
export class AppController {
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      message: 'Stranger Chat backend is running',
    };
  }

  @Post('messages')
  createMessage(@Body() createMessageDto: CreateMessageDto) {
    return {
      message: createMessageDto.text,
    };
  }
}