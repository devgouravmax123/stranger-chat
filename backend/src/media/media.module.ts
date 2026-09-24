import { Module } from '@nestjs/common';
import { B2StorageService } from './b2-storage.service.js';
import { MediaService } from './media.service.js';
import { MediaController } from './media.controller.js';

@Module({
  controllers: [MediaController],
  providers: [B2StorageService, MediaService],
  exports: [B2StorageService, MediaService],
})
export class MediaModule {}
