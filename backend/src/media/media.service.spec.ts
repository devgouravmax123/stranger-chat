import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MediaService } from './media.service.js';
import { B2StorageService } from './b2-storage.service.js';
import { PrismaService } from '../prisma.service.js';
import { PresignedUploadDto } from './dto/presigned-upload.dto.js';

describe('MediaService', () => {
  let mediaService: MediaService;
  let mockPrisma: any;
  let mockB2Storage: any;

  beforeEach(() => {
    mockPrisma = {
      chat: {
        findUnique: vi.fn(),
      },
      mediaAttachment: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
    };

    mockB2Storage = {
      getIsConfigured: vi.fn().mockReturnValue(true),
      getPresignedUploadUrl: vi.fn().mockResolvedValue('https://b2.example.com/upload-presigned-url'),
      getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://b2.example.com/download-presigned-url'),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };

    mediaService = new MediaService(mockPrisma as unknown as PrismaService, mockB2Storage as unknown as B2StorageService);
  });

  describe('createPresignedUpload', () => {
    const validDto: PresignedUploadDto = {
      chatId: 'chat-123',
      mediaType: 'image',
      mimeType: 'image/jpeg',
      fileSize: 1024 * 1024,
      iv: 'AAAAAAAAAAAAAAAA', // valid 12-byte base64
    };

    it('should throw ServiceUnavailableException if B2 storage is not configured', async () => {
      mockB2Storage.getIsConfigured.mockReturnValue(false);

      await expect(
        mediaService.createPresignedUpload('user-1', validDto),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ForbiddenException if user is not a participant of the chat', async () => {
      mockPrisma.chat.findUnique.mockResolvedValue({
        id: 'chat-123',
        userAId: 'user-2',
        userBId: 'user-3',
      });

      await expect(
        mediaService.createPresignedUpload('user-1', validDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should generate server-controlled storageKey and persist MediaAttachment metadata when authorized', async () => {
      mockPrisma.chat.findUnique.mockResolvedValue({
        id: 'chat-123',
        userAId: 'user-1',
        userBId: 'user-2',
      });

      mockPrisma.mediaAttachment.create.mockImplementation(async ({ data }: any) => data);

      const result = await mediaService.createPresignedUpload('user-1', validDto);

      expect(result.mediaId).toBeDefined();
      expect(result.storageKey).toMatch(/^media\/chat-123\/[a-f0-9-]+\.bin$/);
      expect(result.uploadUrl).toBe('https://b2.example.com/upload-presigned-url');
      expect(result.expiresIn).toBe(300);

      expect(mockPrisma.mediaAttachment.create).toHaveBeenCalledWith({
        data: {
          id: result.mediaId,
          chatId: 'chat-123',
          senderId: 'user-1',
          storageKey: result.storageKey,
          mediaType: 'image',
          mimeType: 'image/jpeg',
          fileSize: 1024 * 1024,
          iv: 'AAAAAAAAAAAAAAAA',
        },
      });
    });
  });

  describe('createPresignedDownload', () => {
    it('should throw BadRequestException if mediaId is missing', async () => {
      await expect(
        mediaService.createPresignedDownload('user-1', ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if mediaAttachment does not exist', async () => {
      mockPrisma.mediaAttachment.findUnique.mockResolvedValue(null);

      await expect(
        mediaService.createPresignedDownload('user-1', 'media-999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not in the chat associated with the media', async () => {
      mockPrisma.mediaAttachment.findUnique.mockResolvedValue({
        id: 'media-1',
        storageKey: 'media/chat-1/media-1.bin',
        chat: {
          userAId: 'user-2',
          userBId: 'user-3',
        },
      });

      await expect(
        mediaService.createPresignedDownload('user-1', 'media-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return presigned download URL for authorized chat participant', async () => {
      mockPrisma.mediaAttachment.findUnique.mockResolvedValue({
        id: 'media-1',
        storageKey: 'media/chat-1/media-1.bin',
        chat: {
          userAId: 'user-1',
          userBId: 'user-2',
        },
      });

      const result = await mediaService.createPresignedDownload('user-2', 'media-1');

      expect(result.downloadUrl).toBe('https://b2.example.com/download-presigned-url');
      expect(result.expiresIn).toBe(300);
      expect(mockB2Storage.getPresignedDownloadUrl).toHaveBeenCalledWith('media/chat-1/media-1.bin', 300);
    });
  });
});
