import { Module } from '@nestjs/common';
import { GeminiController } from './gemini.controller.js';
import { GeminiService } from './gemini.service.js';

@Module({
  controllers: [GeminiController],
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
