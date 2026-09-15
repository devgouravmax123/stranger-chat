import { Module } from '@nestjs/common';
import { GeminiController } from './gemini.controller.js';
import { GeminiService } from './gemini.service.js';

import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [GeminiController],
  providers: [GeminiService, PrismaService],
  exports: [GeminiService],
})
export class GeminiModule {}
