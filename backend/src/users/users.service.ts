import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';

import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class UsersService {
  private deletionHook?: (userId: string) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  registerDeletionHook(hook: (userId: string) => Promise<void>) {
    this.deletionHook = hook;
  }

  // ==========================================
  // UPDATE BASIC PROFILE
  // ==========================================

  async updateProfile(
    userId: string,
    dto: CreateProfileDto,
  ) {
    const user =
      await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }

    // ==========================================
    // CHECK USERNAME
    // ==========================================

    const existingUser =
      await this.prisma.user.findUnique({
        where: {
          username:
            dto.username.trim(),
        },
      });

    if (
      existingUser &&
      existingUser.id !== userId
    ) {
      throw new ConflictException(
        'Username already taken. Please choose another username.',
      );
    }

    // ==========================================
    // UPDATE BASIC PROFILE
    // ==========================================

    return this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        username:
          dto.username.trim(),

        age:
          dto.age,

        gender:
          dto.gender.trim(),

        avatar:
          dto.avatar?.trim() ||
          null,
      },

      select: {
        id: true,
        username: true,
        age: true,
        gender: true,
        avatar: true,
        language: true,
        interests: true,
        goal: true,
      },
    });
  }

  // ==========================================
  // UPDATE MATCHING PREFERENCES
  // ==========================================

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ) {
    const user =
      await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }

    // ==========================================
    // CLEAN INTERESTS
    // ==========================================

    const cleanInterests =
      Array.isArray(dto.interests)
        ? dto.interests
            .map((interest) =>
              interest.trim(),
            )
            .filter(
              (interest) =>
                interest.length > 0,
            )
        : [];

    // ==========================================
    // UPDATE PREFERENCES
    // ==========================================

    return this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        language:
          dto.language.trim(),

        interests:
          cleanInterests,

        goal:
          dto.goal.trim(),
      },

      select: {
        id: true,
        username: true,
        age: true,
        gender: true,
        avatar: true,
        language: true,
        interests: true,
        goal: true,
      },
    });
  }

  // ==========================================
  // GET PROFILE
  // ==========================================

  async getProfile(
    userId: string,
  ) {
    const user =
      await this.prisma.user.findUnique({
        where: {
          id: userId,
        },

        select: {
          id: true,
          username: true,
          age: true,
          gender: true,
          avatar: true,
          language: true,
          interests: true,
          goal: true,
        },
      });

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }

    return user;
  }

  // ==========================================
  // PERMANENT ACCOUNT DELETION
  // ==========================================

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 1. Notify WebSocket gateway to disconnect sockets and clean active chats
    if (this.deletionHook) {
      try {
        await this.deletionHook(userId);
      } catch (err) {
        console.warn(`[Account Deletion] Gateway hook warning:`, err);
      }
    }

    // 2. Perform Atomic Database Purge in a Prisma Transaction
    await this.prisma.$transaction(async (tx) => {
      // a. Find all friendships involving this user
      const friendships = await tx.friendship.findMany({
        where: {
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        select: { id: true, chatId: true },
      });

      const friendChatIds = friendships
        .map((f) => f.chatId)
        .filter((id): id is string => !!id);

      // b. Find all stranger chats involving this user
      const strangerChats = await tx.chat.findMany({
        where: {
          OR: [{ userAId: userId }, { userBId: userId }],
          id: { notIn: friendChatIds },
        },
        select: { id: true },
      });

      const allChatIds = [
        ...friendChatIds,
        ...strangerChats.map((c) => c.id),
      ];

      // c. Delete messages in all those chats
      if (allChatIds.length > 0) {
        await tx.message.deleteMany({
          where: { chatId: { in: allChatIds } },
        });
      }

      // d. Delete any remaining messages sent by this user anywhere
      await tx.message.deleteMany({
        where: { senderId: userId },
      });

      // e. Delete friendships
      await tx.friendship.deleteMany({
        where: {
          OR: [{ userAId: userId }, { userBId: userId }],
        },
      });

      // f. Delete reports involving the chats or user
      await tx.report.deleteMany({
        where: {
          OR: [
            { reporterId: userId },
            { reportedId: userId },
            ...(allChatIds.length > 0 ? [{ chatId: { in: allChatIds } }] : []),
          ],
        },
      });

      // g. Delete the chats
      if (allChatIds.length > 0) {
        await tx.chat.deleteMany({
          where: { id: { in: allChatIds } },
        });
      }

      // h. Delete friend requests sent or received
      await tx.friendRequest.deleteMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }],
        },
      });

      // i. Delete blocks made or received
      await tx.block.deleteMany({
        where: {
          OR: [{ blockerId: userId }, { blockedId: userId }],
        },
      });

      // j. Delete reactions by user
      await tx.reaction.deleteMany({
        where: { userId },
      });

      // k. Delete notifications for user
      await tx.notification.deleteMany({
        where: { userId },
      });

      // l. Finally delete user record
      await tx.user.delete({
        where: { id: userId },
      });
    });

    // 3. Clean up Redis presence, temporary states, and AI quota keys
    await this.redis.cleanupUserRedisState(userId);

    return {
      success: true,
      message: 'Account and all associated user data permanently deleted.',
    };
  }
}