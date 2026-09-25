import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';
import { B2StorageService } from './b2-storage.service.js';
import { PresignedUploadDto } from './dto/presigned-upload.dto.js';

export interface PresignedUploadResponse {
  mediaId: string;
  storageKey: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface PresignedDownloadResponse {
  downloadUrl: string;
  expiresIn: number;
}

@Injectable()
export class MediaService {
  private readonly defaultExpirySeconds = 300; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly b2Storage: B2StorageService,
  ) {}

  /**
   * Authorizes that a user is a member of the requested chat.
   * Covers both Stranger Chat and Friend Chat relationships.
   */
  async verifyChatAccess(chatId: string, userId: string): Promise<boolean> {
    if (!chatId || !userId) return false;

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: {
        id: true,
        userAId: true,
        userBId: true,
        endedAt: true,
      },
    });

    if (!chat) return false;

    // Check if user is either participant
    return chat.userAId === userId || chat.userBId === userId;
  }

  /**
   * Creates a presigned upload URL and records the pending MediaAttachment in PostgreSQL.
   */
  async createPresignedUpload(
    userId: string,
    dto: PresignedUploadDto,
  ): Promise<PresignedUploadResponse> {
    if (!this.b2Storage.getIsConfigured()) {
      throw new ServiceUnavailableException(
        'Backblaze B2 storage is not configured on the server.',
      );
    }

    const hasAccess = await this.verifyChatAccess(dto.chatId, userId);
    if (!hasAccess) {
      throw new ForbiddenException(
        'You are not authorized to upload media to this chat.',
      );
    }

    // Generate unique server-controlled identifiers
    const mediaId = randomUUID();
    const storageKey = `media/${dto.chatId}/${mediaId}.bin`;

    // Generate presigned PUT URL
    const uploadUrl = await this.b2Storage.getPresignedUploadUrl(
      storageKey,
      dto.mimeType,
      this.defaultExpirySeconds,
    );

    // Persist MediaAttachment metadata (messageId is nullable initially)
    await this.prisma.mediaAttachment.create({
      data: {
        id: mediaId,
        chatId: dto.chatId,
        senderId: userId,
        storageKey,
        mediaType: dto.mediaType,
        mimeType: dto.mimeType,
        fileSize: dto.fileSize,
        iv: dto.iv,
      },
    });

    return {
      mediaId,
      storageKey,
      uploadUrl,
      expiresIn: this.defaultExpirySeconds,
    };
  }

  /**
   * Verifies access and generates a presigned download URL for an existing MediaAttachment.
   */
  async createPresignedDownload(
    userId: string,
    mediaId: string,
  ): Promise<PresignedDownloadResponse> {
    if (!this.b2Storage.getIsConfigured()) {
      throw new ServiceUnavailableException(
        'Backblaze B2 storage is not configured on the server.',
      );
    }

    if (!mediaId || typeof mediaId !== 'string') {
      throw new BadRequestException('Invalid media ID.');
    }

    const attachment = await this.prisma.mediaAttachment.findUnique({
      where: { id: mediaId },
      include: {
        chat: {
          select: {
            userAId: true,
            userBId: true,
          },
        },
      },
    });

    if (!attachment) {
      throw new NotFoundException('Media attachment not found.');
    }

    // Verify user participates in the chat
    const isParticipant =
      attachment.chat.userAId === userId || attachment.chat.userBId === userId;

    if (!isParticipant) {
      throw new ForbiddenException(
        'You are not authorized to access media from this chat.',
      );
    }

    const downloadUrl = await this.b2Storage.getPresignedDownloadUrl(
      attachment.storageKey,
      this.defaultExpirySeconds,
    );

    return {
      downloadUrl,
      expiresIn: this.defaultExpirySeconds,
    };
  }

  /**
   * Batch deletes raw encrypted media objects from B2 by their storage keys.
   */
  async deleteMediaObjects(storageKeys: string[]): Promise<void> {
    if (!storageKeys || storageKeys.length === 0) return;
    await this.b2Storage.deleteObjects(storageKeys);
  }
}
