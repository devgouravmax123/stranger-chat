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
            delete: vi.fn().mockResolvedValue({ id: 'user-1' }),
          },
        };
        return cb(txMock);
      }),
    };

    mockRedis = {
      cleanupUserRedisState: vi.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
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
  });
});
