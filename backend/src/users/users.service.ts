import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';

import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { normalizeInterest } from '../constants/interests.js';
import { RedisService } from '../redis/redis.service.js';
import { MediaService } from '../media/media.service.js';

@Injectable()
export class UsersService implements OnModuleInit {
  private deletionHook?: (userId: string) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mediaService: MediaService,
  ) {}

  async onModuleInit() {
    await this.ensurePlatformStatsBaseline();
  }

  /**
   * One-time baseline initialization for PlatformStats.
   * If PlatformStats(id="global") already exists, it does absolutely nothing to the counters.
   * If it does not exist, it seeds totalSignups with the count of already registered users.
   * Subsequent server restarts will never reset or recalculate totalSignups.
   */
  private async ensurePlatformStatsBaseline() {
    try {
      const existingStats = await this.prisma.platformStats.findUnique({
        where: { id: 'global' },
      });

      if (!existingStats) {
        const registeredCount = await this.prisma.user.count({
          where: { username: { not: null } },
        });

        await this.prisma.platformStats.create({
          data: {
            id: 'global',
            totalSignups: registeredCount,
            totalDeletedAccounts: 0,
          },
        }).catch(() => {
          // If another process created it concurrently, safely ignore
        });
      }
    } catch (err) {
      console.warn('[PlatformStats] Warning checking stats baseline:', err);
    }
  }

  registerDeletionHook(hook: (userId: string) => Promise<void>) {
    this.deletionHook = hook;
  }

  async createAnonymousUser() {
    return this.prisma.user.create({ data: {} });
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

    const profileData: any = {
      username: dto.username.trim(),
      age: dto.age,
      gender: dto.gender.trim(),
      avatar: dto.avatar?.trim() || null,
    };

    if (Array.isArray(dto.interests)) {
      profileData.interests = dto.interests
        .filter((i): i is string => typeof i === 'string')
        .map((i) => normalizeInterest(i))
        .filter((i) => i.length > 0);
    }

    if (dto.language !== undefined && typeof dto.language === 'string') {
      profileData.language = dto.language.trim();
    }

    if (dto.goal !== undefined && typeof dto.goal === 'string') {
      profileData.goal = dto.goal.trim();
    }

    const isFirstTimeRegistration = !user.username && !!profileData.username;

    if (isFirstTimeRegistration) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: profileData,
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

        await tx.platformStats.upsert({
          where: { id: 'global' },
          create: { id: 'global', totalSignups: 1, totalDeletedAccounts: 0 },
          update: { totalSignups: { increment: 1 } },
        });

        return updated;
      });
    }

    return this.prisma.user.update({
      where: {
        id: userId,
      },

      data: profileData,

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
    // CLEAN & NORMALIZE INTERESTS
    // ==========================================

    const cleanInterests =
      Array.isArray(dto.interests)
        ? dto.interests
            .filter((interest): interest is string => typeof interest === 'string')
            .map((interest) =>
              normalizeInterest(interest),
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
        publicKey: true,
      },
    });
  }

  // ==========================================
  // UPDATE PUBLIC KEY (E2EE IDENTITY KEY)
  // ==========================================

  async updatePublicKey(userId: string, base64PublicKey: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Cryptographic validation: Verify that base64PublicKey can be imported as a valid ECDH P-256 SPKI key
    try {
      const { webcrypto } = await import('node:crypto');
      const binaryBuf = Buffer.from(base64PublicKey, 'base64');
      await webcrypto.subtle.importKey(
        'spki',
        binaryBuf,
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        true,
        [],
      );
    } catch (err: any) {
      throw new BadRequestException(
        'Invalid public key: Must be a valid ECDH P-256 SPKI public key',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { publicKey: base64PublicKey },
      select: {
        id: true,
        username: true,
        publicKey: true,
      },
    });

    return updated;
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
          publicKey: true,
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

    // 1. Notify WebSocket gateway to disconnect sockets, tear down active calls, and clean active chats
    if (this.deletionHook) {
      try {
        await this.deletionHook(userId);
      } catch (err) {
        console.warn(`[Account Deletion] Gateway hook warning:`, err);
      }
    }

    // 2. Identify all chat IDs and collect all B2 storageKeys belonging to the user BEFORE DB deletion
    let storageKeysToDelete: string[] = [];

    // Perform Atomic Database Purge in a Prisma Transaction
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

      // c. Collect all B2 storageKeys that belong to this user or to the chats being deleted
      // Covers:
      // - Media sent by user (attached or unattached/pending where messageId = null)
      // - Media in any chats being deleted as part of user account deletion
      const mediaRecords = await tx.mediaAttachment.findMany({
        where: {
          OR: [
            { senderId: userId },
            ...(allChatIds.length > 0 ? [{ chatId: { in: allChatIds } }] : []),
          ],
        },
        select: { storageKey: true },
      });

      storageKeysToDelete = Array.from(
        new Set(
          mediaRecords
            .map((m) => m.storageKey)
            .filter((k): k is string => typeof k === 'string' && k.trim().length > 0),
        ),
      );

      // d. Delete messages in all those chats
      if (allChatIds.length > 0) {
        await tx.message.deleteMany({
          where: { chatId: { in: allChatIds } },
        });
      }

      // e. Delete any remaining messages sent by this user anywhere
      await tx.message.deleteMany({
        where: { senderId: userId },
      });

      // f. Explicitly delete MediaAttachment records belonging to the user
      // Ensures pending/unattached media (messageId = null) and any user media are removed even if chat not deleted
      await tx.mediaAttachment.deleteMany({
        where: {
          OR: [
            { senderId: userId },
            ...(allChatIds.length > 0 ? [{ chatId: { in: allChatIds } }] : []),
          ],
        },
      });

      // g. Delete friendships
      await tx.friendship.deleteMany({
        where: {
          OR: [{ userAId: userId }, { userBId: userId }],
        },
      });

      // h. Delete reports involving the chats or user
      await tx.report.deleteMany({
        where: {
          OR: [
            { reporterId: userId },
            { reportedId: userId },
            ...(allChatIds.length > 0 ? [{ chatId: { in: allChatIds } }] : []),
          ],
        },
      });

      // i. Delete the chats
      if (allChatIds.length > 0) {
        await tx.chat.deleteMany({
          where: { id: { in: allChatIds } },
        });
      }

      // j. Delete friend requests sent or received
      await tx.friendRequest.deleteMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }],
        },
      });

      // k. Delete blocks made or received
      await tx.block.deleteMany({
        where: {
          OR: [{ blockerId: userId }, { blockedId: userId }],
        },
      });

      // l. Delete reactions by user
      await tx.reaction.deleteMany({
        where: { userId },
      });

      // m. Delete notifications for user
      await tx.notification.deleteMany({
        where: { userId },
      });

      // n. Finally delete user record
      await tx.user.delete({
        where: { id: userId },
      });

      // o. Atomically increment totalDeletedAccounts counter
      await tx.platformStats.upsert({
        where: { id: 'global' },
        create: { id: 'global', totalSignups: 0, totalDeletedAccounts: 1 },
        update: { totalDeletedAccounts: { increment: 1 } },
      });
    });

    // 3. Purge B2 Encrypted Objects AFTER PostgreSQL transaction has committed successfully
    let b2CleanupFailed = false;
    if (storageKeysToDelete.length > 0) {
      try {
        await this.mediaService.deleteMediaObjects(storageKeysToDelete);
        console.log(`[Account Deletion] Successfully deleted ${storageKeysToDelete.length} B2 media object(s) for user ${userId}`);
      } catch (b2Err: any) {
        b2CleanupFailed = true;
        // Log clear server-side diagnostic without exposing credentials or throwing after DB commit
        console.error(
          `[Account Deletion] WARNING: Database records purged, but B2 media cleanup failed for user ${userId}. Error: ${b2Err?.message || b2Err}`,
        );
      }
    }

    // 4. Clean up Redis presence, temporary states, and AI quota keys
    await this.redis.cleanupUserRedisState(userId);

    return {
      success: true,
      message: 'Account and all associated user data permanently deleted.',
      storageCleanup: b2CleanupFailed ? 'pending' : 'completed',
    };
  }
}