import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // SEND FRIEND REQUEST
  // ==========================================

  async sendFriendRequest(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException(
        'You cannot send a friend request to yourself',
      );
    }

    const receiver = await this.prisma.user.findUnique({
      where: {
        id: receiverId,
      },
    });

    if (!receiver) {
      throw new NotFoundException('User not found');
    }

    // Check blocks
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          {
            blockerId: senderId,
            blockedId: receiverId,
          },
          {
            blockerId: receiverId,
            blockedId: senderId,
          },
        ],
      },
    });

    if (blocked) {
      throw new BadRequestException(
        'Friend request cannot be sent because one user has blocked the other',
      );
    }

    // Check existing friendship
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          {
            userAId: senderId,
            userBId: receiverId,
          },
          {
            userAId: receiverId,
            userBId: senderId,
          },
        ],
      },
    });

    if (friendship) {
      throw new BadRequestException('You are already friends');
    }

    // Check existing request
    const existingRequest = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          {
            senderId,
            receiverId,
          },
          {
            senderId: receiverId,
            receiverId: senderId,
          },
        ],
      },
    });

    if (existingRequest) {
      throw new BadRequestException(
        'A friend request already exists between these users',
      );
    }

    const request = await this.prisma.friendRequest.create({
      data: {
        senderId,
        receiverId,
      },
    });

    return {
      message: 'Friend request sent',
      requestId: request.id,
      status: request.status,
    };
  }

  // ==========================================
  // GET FRIEND REQUESTS
  // ==========================================

  async getFriendRequests(userId: string) {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: 'PENDING',
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            age: true,
            gender: true,
            avatar: true,
          },
        },
      },
    });

    return requests;
  }

  // ==========================================
  // ACCEPT FRIEND REQUEST
  // ==========================================

  async acceptFriendRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: {
        id: requestId,
      },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId) {
      throw new BadRequestException(
        'You cannot accept this friend request',
      );
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        'This friend request is no longer pending',
      );
    }

    // Check blocks
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          {
            blockerId: request.senderId,
            blockedId: request.receiverId,
          },
          {
            blockerId: request.receiverId,
            blockedId: request.senderId,
          },
        ],
      },
    });

    if (blocked) {
      throw new BadRequestException(
        'Friendship cannot be created because one user has blocked the other',
      );
    }

    // Check existing friendship
    const existingFriendship =
      await this.prisma.friendship.findFirst({
        where: {
          OR: [
            {
              userAId: request.senderId,
              userBId: request.receiverId,
            },
            {
              userAId: request.receiverId,
              userBId: request.senderId,
            },
          ],
        },
      });

    if (existingFriendship) {
      throw new BadRequestException('You are already friends');
    }

    // ==========================================
    // CREATE FRIENDSHIP + PRIVATE CHAT
    // ==========================================

    const result = await this.prisma.$transaction(async (tx) => {
      // Mark request as accepted
      await tx.friendRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: 'ACCEPTED',
        },
      });

      // Create private 1-to-1 chat
      const chat = await tx.chat.create({
        data: {
          userAId: request.senderId,
          userBId: request.receiverId,
        },
      });

      // Create friendship connected to private chat
      const friendship = await tx.friendship.create({
        data: {
          userAId: request.senderId,
          userBId: request.receiverId,
          chatId: chat.id,
        },
      });

      return {
        friendship,
        chat,
      };
    });

    return {
      message: 'Friend request accepted',
      friendshipId: result.friendship.id,
      chatId: result.chat.id,
      status: 'ACCEPTED',
    };
  }

  // ==========================================
  // REJECT FRIEND REQUEST
  // ==========================================

  async rejectFriendRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: {
        id: requestId,
      },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId) {
      throw new BadRequestException(
        'You cannot reject this friend request',
      );
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        'This friend request is no longer pending',
      );
    }

    const updatedRequest =
      await this.prisma.friendRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: 'REJECTED',
        },
      });

    return {
      message: 'Friend request rejected',
      requestId: updatedRequest.id,
      status: updatedRequest.status,
    };
  }

  // ==========================================
  // GET FRIENDS
  // ==========================================

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [
          {
            userAId: userId,
          },
          {
            userBId: userId,
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        userA: {
          select: {
            id: true,
            username: true,
            age: true,
            gender: true,
            avatar: true,
            lastSeenAt: true,
          },
        },
        userB: {
          select: {
            id: true,
            username: true,
            age: true,
            gender: true,
            avatar: true,
            lastSeenAt: true,
          },
        },
        chat: {
          select: {
            id: true,
          },
        },
      },
    });

    return friendships.map((friendship) => {
      const friend =
        friendship.userAId === userId
          ? friendship.userB
          : friendship.userA;

      return {
        friendshipId: friendship.id,
        createdAt: friendship.createdAt,
        chatId: friendship.chatId,
        friend,
      };
    });
  }

  // ==========================================
  // GET PRIVATE FRIEND CHAT
  // ==========================================

  async getFriendChat(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          {
            userAId: userId,
            userBId: friendId,
          },
          {
            userAId: friendId,
            userBId: userId,
          },
        ],
      },
      include: {
        chat: true,
      },
    });

    if (!friendship) {
      throw new NotFoundException(
        'You are not friends with this user',
      );
    }

    if (!friendship.chat) {
      throw new NotFoundException(
        'Private chat not found',
      );
    }

    return {
      friendshipId: friendship.id,
      chatId: friendship.chat.id,
      userId,
      friendId,
    };
  }

  // ==========================================
  // GET PRIVATE CHAT MESSAGES
  // ==========================================

  async getFriendChatMessages(
    userId: string,
    friendId: string,
  ) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          {
            userAId: userId,
            userBId: friendId,
          },
          {
            userAId: friendId,
            userBId: userId,
          },
        ],
      },
      include: {
        chat: true,
      },
    });

    if (!friendship || !friendship.chat) {
      throw new NotFoundException(
        'Private chat not found',
      );
    }

    return this.prisma.message.findMany({
      where: {
        chatId: friendship.chat.id,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  // ==========================================
  // REMOVE FRIEND
  // ==========================================

  async removeFriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          {
            userAId: userId,
            userBId: friendId,
          },
          {
            userAId: friendId,
            userBId: userId,
          },
        ],
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Delete messages from private chat
      if (friendship.chatId) {
        await tx.message.deleteMany({
          where: {
            chatId: friendship.chatId,
          },
        });

        await tx.chat.delete({
          where: {
            id: friendship.chatId,
          },
        });
      }

      // Delete friendship
      await tx.friendship.delete({
        where: {
          id: friendship.id,
        },
      });
    });

    return {
      message: 'Friend removed',
    };
  }
}