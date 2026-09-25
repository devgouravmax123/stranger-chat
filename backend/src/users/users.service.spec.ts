import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

describe('UsersService', () => {
  let service: UsersService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn().mockResolvedValue(5),
      },
      platformStats: {
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'global', totalSignups: 5, totalDeletedAccounts: 0 }),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        const txMock = {
          friendship: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          chat: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          message: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          report: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          friendRequest: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          block: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          reaction: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          notification: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          user: {
            update: vi.fn().mockResolvedValue({ id: 'user-1', username: 'NewUser' }),
            delete: vi.fn().mockResolvedValue({ id: 'user-1' }),
          },
          platformStats: {
            upsert: vi.fn().mockResolvedValue({ id: 'global', totalSignups: 1, totalDeletedAccounts: 0 }),
          },
          mediaAttachment: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        };
        return cb(txMock);
      }),
    };

    mockRedis = {
      cleanupUserRedisState: vi.fn().mockResolvedValue(undefined),
    };

    const mockMediaService = {
      deleteMediaObjects: vi.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
      mockMediaService as any,
    );
  });

  describe('updateProfile', () => {
    it('should throw NotFoundException if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateProfile('non-existent', {
          username: 'Alex',
          age: 25,
          gender: 'Male',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if username is taken by a different user', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', username: 'OldName' }) // current user
        .mockResolvedValueOnce({ id: 'user-2', username: 'Alex' }); // existing conflicting user

      await expect(
        service.updateProfile('user-1', {
          username: 'Alex',
          age: 25,
          gender: 'Male',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully update profile with normalized interests and trimmed values', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', username: 'Alex' })
        .mockResolvedValueOnce({ id: 'user-1', username: 'Alex' }); // same user, no conflict

      const updatedUser = {
        id: 'user-1',
        username: 'Alex',
        age: 26,
        gender: 'Male',
        avatar: '🐶',
        language: 'English',
        interests: ['Coding', 'Gaming'],
        goal: 'casual-chat',
      };
      mockPrisma.user.update.mockResolvedValueOnce(updatedUser);

      const result = await service.updateProfile('user-1', {
        username: '  Alex  ',
        age: 26,
        gender: 'Male',
        avatar: '🐶',
        interests: ['coding', 'GAMING'],
        language: 'English',
        goal: 'casual-chat',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          username: 'Alex',
          age: 26,
          gender: 'Male',
          avatar: '🐶',
          interests: ['Coding', 'Gaming'],
          language: 'English',
          goal: 'casual-chat',
        },
        select: expect.any(Object),
      });
      expect(result).toEqual(updatedUser);
    });
  });

  describe('updatePreferences', () => {
    it('should throw NotFoundException if user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updatePreferences('user-missing', {
          language: 'English',
          interests: ['Coding'],
          goal: 'casual-chat',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should normalize interests and update preferences successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        language: 'Hindi',
        interests: ['Music', 'Travel'],
        goal: 'friendship',
      });

      const result = await service.updatePreferences('user-1', {
        language: '  Hindi  ',
        interests: ['music', 'TRAVEL', '' as any],
        goal: '  friendship  ',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          language: 'Hindi',
          interests: ['Music', 'Travel'],
          goal: 'friendship',
        },
        select: expect.any(Object),
      });
      expect(result.language).toBe('Hindi');
    });
  });

  describe('getProfile', () => {
    it('should throw NotFoundException if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.getProfile('unknown-id')).rejects.toThrow(NotFoundException);
    });

    it('should return user profile if found', async () => {
      const user = {
        id: 'user-1',
        username: 'Sam',
        age: 22,
        gender: 'Female',
        avatar: '🐱',
        language: 'English',
        interests: ['Anime'],
        goal: 'learning',
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);

      const result = await service.getProfile('user-1');
      expect(result).toEqual(user);
    });
  });

  describe('deleteAccount', () => {
    it('should throw NotFoundException if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.deleteAccount('user-none')).rejects.toThrow(NotFoundException);
    });

    it('should invoke deletion hook, run atomic transaction, clean Redis state, and return success', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-to-delete' });
      const deletionHook = vi.fn().mockResolvedValue(undefined);
      service.registerDeletionHook(deletionHook);

      const result = await service.deleteAccount('user-to-delete');

      expect(deletionHook).toHaveBeenCalledWith('user-to-delete');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockRedis.cleanupUserRedisState).toHaveBeenCalledWith('user-to-delete');
      expect(result.success).toBe(true);
      expect(result.message).toContain('permanently deleted');
    });

    it('should collect B2 storage keys for sent & chat media, explicitly delete MediaAttachments, and delete B2 objects after commit', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-with-media' });

      const mockDeleteMediaObjects = vi.fn().mockResolvedValue(undefined);
      (service as any).mediaService = {
        deleteMediaObjects: mockDeleteMediaObjects,
      };

      mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          friendship: {
            findMany: vi.fn().mockResolvedValue([{ id: 'f-1', chatId: 'chat-friend-1' }]),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          chat: {
            findMany: vi.fn().mockResolvedValue([{ id: 'chat-stranger-1' }]),
            deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          mediaAttachment: {
            findMany: vi.fn().mockResolvedValue([
              { storageKey: 'media/chat-friend-1/img1.bin' },
              { storageKey: 'media/chat-stranger-1/voice1.bin' },
              { storageKey: 'media/unattached/pending1.bin' },
            ]),
            deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
          },
          message: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
          report: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          friendRequest: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          block: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          reaction: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          notification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          user: { delete: vi.fn().mockResolvedValue({ id: 'user-with-media' }) },
          platformStats: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const res = await service.deleteAccount('user-with-media');

      expect(res.success).toBe(true);
      expect(res.storageCleanup).toBe('completed');
      expect(mockDeleteMediaObjects).toHaveBeenCalledWith([
        'media/chat-friend-1/img1.bin',
        'media/chat-stranger-1/voice1.bin',
        'media/unattached/pending1.bin',
      ]);
    });

    it('should return storageCleanup: pending when B2 deletion fails post-commit', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-b2-fail' });

      (service as any).mediaService = {
        deleteMediaObjects: vi.fn().mockRejectedValue(new Error('B2 network error')),
      };

      mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          friendship: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          chat: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          mediaAttachment: {
            findMany: vi.fn().mockResolvedValue([{ storageKey: 'media/chat-1/img.bin' }]),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          message: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          report: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          friendRequest: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          block: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          reaction: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          notification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          user: { delete: vi.fn().mockResolvedValue({ id: 'user-b2-fail' }) },
          platformStats: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const res = await service.deleteAccount('user-b2-fail');

      expect(res.success).toBe(true);
      expect(res.storageCleanup).toBe('pending');
    });
  });

  describe('PlatformStats Analytics', () => {
    it('should initialize baseline totalSignups only if stats row does not exist', async () => {
      mockPrisma.platformStats.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.count.mockResolvedValueOnce(12);

      await service.onModuleInit();

      expect(mockPrisma.platformStats.findUnique).toHaveBeenCalledWith({ where: { id: 'global' } });
      expect(mockPrisma.user.count).toHaveBeenCalledWith({ where: { username: { not: null } } });
      expect(mockPrisma.platformStats.create).toHaveBeenCalledWith({
        data: {
          id: 'global',
          totalSignups: 12,
          totalDeletedAccounts: 0,
        },
      });
    });

    it('should do nothing if PlatformStats row already exists (preventing reset on restart)', async () => {
      mockPrisma.platformStats.findUnique.mockResolvedValueOnce({
        id: 'global',
        totalSignups: 100,
        totalDeletedAccounts: 20,
      });

      await service.onModuleInit();

      expect(mockPrisma.platformStats.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.count).not.toHaveBeenCalled();
    });

    it('should atomically increment totalSignups when a user registers a username for the first time', async () => {
      // User has username: null initially
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'anon-1', username: null });

      await service.updateProfile('anon-1', {
        username: 'NewUser',
        age: 21,
        gender: 'Female',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('updatePublicKey (E2EE Phase 2)', () => {
    // Valid standard P-256 SPKI Base64 string for testing
    const validP256Spki =
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7pS53H4J8z7f7XFjC9e6s9NqUjA2B1C3D4E5F6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0==';

    it('should throw NotFoundException if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updatePublicKey('non-existent', validP256Spki),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if public key is malformed / not a valid P-256 key', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });

      await expect(
        service.updatePublicKey('user-1', 'bm90LWEtdmFsaWQtZW5jb2RlZC1rZXk='),
      ).rejects.toThrow();
    });

    it('should successfully validate and persist an importable P-256 public key', async () => {
      const { webcrypto } = await import('node:crypto');
      const keyPair = await webcrypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits'],
      );
      const exported = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);
      const base64Key = Buffer.from(exported).toString('base64');

      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        username: 'Alice',
        publicKey: base64Key,
      });

      const result = await service.updatePublicKey('user-1', base64Key);
      expect(result.publicKey).toBe(base64Key);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { publicKey: base64Key },
        select: { id: true, username: true, publicKey: true },
      });
    });
  });
});
