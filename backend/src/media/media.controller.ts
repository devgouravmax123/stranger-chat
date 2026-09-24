import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { PresignedUploadDto } from './dto/presigned-upload.dto.js';
import {
  MediaService,
  PresignedDownloadResponse,
  PresignedUploadResponse,
} from './media.service.js';

@Controller('media')
@UseGuards(SessionAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Generates a presigned URL allowing the browser to upload an encrypted media object directly to B2.
   */
  @Post('presigned-upload')
  async getPresignedUpload(
    @Req() req: any,
    @Body() dto: PresignedUploadDto,
  ): Promise<PresignedUploadResponse> {
    const authenticatedUserId = req.user.userId;
    return await this.mediaService.createPresignedUpload(authenticatedUserId, dto);
  }

  /**
   * Generates a short-lived presigned GET URL for an authorized user to download encrypted media.
   */
  @Get('presigned-download/:mediaId')
  async getPresignedDownload(
    @Req() req: any,
    @Param('mediaId') mediaId: string,
  ): Promise<PresignedDownloadResponse> {
    const authenticatedUserId = req.user.userId;
    return await this.mediaService.createPresignedDownload(authenticatedUserId, mediaId);
  }
}
