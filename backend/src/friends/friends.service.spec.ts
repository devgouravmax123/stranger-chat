import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { PrismaService } from '../prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('FriendsService', () => {
  let service: FriendsService;
  let mockPrisma: any;
  let mockNotifications: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      block: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      friendship: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      friendRequest: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        const txMock = {
          friendRequest: {
            update: vi.fn().mockResolvedValue({ id: 'req-1', status: 'ACCEPTED' }),
          },
          chat: {
            create: vi.fn().mockResolvedValue({ id: 'chat-1' }),
          },
          friendship: {
            create: vi.fn().mockResolvedValue({ id: 'friendship-1' }),
          },
        };
        return cb(txMock);
      }),
    };

    mockNotifications = {
      createNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    service = new FriendsService(
      mockPrisma as unknown as PrismaService,
      mockNotifications as unknown as NotificationsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendFriendRequest', () => {
    it('should throw BadRequestException when trying to friend oneself', async () => {
      await expect(service.sendFriendRequest('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if receiver does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.sendFriendRequest('user-1', 'user-none')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if one user has blocked the other', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-2' });
      mockPrisma.block.findFirst.mockResolvedValueOnce({ id: 'block-1' });

      await expect(service.sendFriendRequest('user-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if already friends', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-2' });
      mockPrisma.block.findFirst.mockResolvedValueOnce(null);
      mockPrisma.friendship.findFirst.mockResolvedValueOnce({ id: 'f-1' });

      await expect(service.sendFriendRequest('user-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if a friend request is already pending', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-2' });
      mockPrisma.block.findFirst.mockResolvedValueOnce(null);
      mockPrisma.friendship.findFirst.mockResolvedValueOnce(null);
      mockPrisma.friendRequest.findFirst.mockResolvedValueOnce({ id: 'req-pending' });

      await expect(service.sendFriendRequest('user-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create friend request and trigger notification on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user-2' });
      mockPrisma.block.findFirst.mockResolvedValueOnce(null);
      mockPrisma.friendship.findFirst.mockResolvedValueOnce(null);
      mockPrisma.friendRequest.findFirst.mockResolvedValueOnce(null);
      mockPrisma.friendRequest.create.mockResolvedValueOnce({
        id: 'req-new',
        status: 'PENDING',
        sender: { username: 'SenderUser' },
      });

      const result = await service.sendFriendRequest('user-1', 'user-2');

      expect(mockPrisma.friendRequest.create).toHaveBeenCalledWith({
        data: { senderId: 'user-1', receiverId: 'user-2' },
        include: { sender: { select: { username: true, avatar: true } } },
      });
      expect(mockNotifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          type: 'FRIEND_REQUEST',
        }),
      );
      expect(result.message).toBe('Friend request sent');
      expect(result.requestId).toBe('req-new');
    });
  });

  describe('acceptFriendRequest', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValueOnce(null);

      await expect(service.acceptFriendRequest('req-none', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user is not the receiver', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
        id: 'req-1',
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'PENDING',
      });

      await expect(service.acceptFriendRequest('req-1', 'unauthorized-user')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if request is not PENDING', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
        id: 'req-1',
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'ACCEPTED',
      });

      await expect(service.acceptFriendRequest('req-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should accept request, create chat and friendship, and notify sender', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
        id: 'req-1',
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'PENDING',
      });
      mockPrisma.block.findFirst.mockResolvedValueOnce(null);
      mockPrisma.friendship.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ username: 'Alice' });

      const result = await service.acceptFriendRequest('req-1', 'user-2');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockNotifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'FRIEND_ACCEPTED',
        }),
      );
      expect(result.status).toBe('ACCEPTED');
      expect(result.message).toBe('Friend request accepted');
    });
  });

  describe('rejectFriendRequest', () => {
    it('should throw NotFoundException if request not found', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValueOnce(null);

      await expect(service.rejectFriendRequest('req-none', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user is not the receiver', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
        id: 'req-1',
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'PENDING',
      });

      await expect(service.rejectFriendRequest('req-1', 'user-wrong')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update request status to REJECTED on success', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValueOnce({
        id: 'req-1',
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'PENDING',
      });
      mockPrisma.friendRequest.update.mockResolvedValueOnce({
        id: 'req-1',
        status: 'REJECTED',
      });

      const result = await service.rejectFriendRequest('req-1', 'user-2');

      expect(mockPrisma.friendRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'REJECTED' },
      });
      expect(result.message).toBe('Friend request rejected');
      expect(result.status).toBe('REJECTED');
    });
  });
});
