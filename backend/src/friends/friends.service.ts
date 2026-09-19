import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { normalizeInterest } from '../constants/interests.js';

@Injectable()
export class FriendsService {
  private presenceChecker?: (userId: string) => Promise<boolean> | boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private batchPresenceChecker?: (userIds: string[]) => Promise<Set<string>> | Set<string>;
  private userRelationshipsCache = new Map<string, { data: { friendIdSet: Set<string>; sentRequestSet: Set<string>; receivedRequestMap: Map<string, string>; blockedSet: Set<string> }; expiresAt: number }>();
  private inFlightRelationships = new Map<string, Promise<{ friendIdSet: Set<string>; sentRequestSet: Set<string>; receivedRequestMap: Map<string, string>; blockedSet: Set<string> }>>();
  private friendsCache = new Map<string, { data: any[]; expiresAt: number }>();
  private inFlightFriends = new Map<string, Promise<any[]>>();

  registerPresenceChecker(checker: (userId: string) => Promise<boolean> | boolean) {
    this.presenceChecker = checker;
  }

  registerBatchPresenceChecker(checker: (userIds: string[]) => Promise<Set<string>> | Set<string>) {
    this.batchPresenceChecker = checker;
  }

  invalidateUserRelationships(userId: string) {
    this.userRelationshipsCache.delete(userId);
    this.friendsCache.delete(userId);
  }

  private async getUserRelationships(userId: string) {
    const now = Date.now();
    const cached = this.userRelationshipsCache.get(userId);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }

    const inFlight = this.inFlightRelationships.get(userId);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      try {
        const [friendships, sentRequests, receivedRequests, blocks] = await Promise.all([
          this.prisma.friendship.findMany({
            where: {
              OR: [{ userAId: userId }, { userBId: userId }],
            },
            select: {
              userAId: true,
              userBId: true,
            },
          }),
          this.prisma.friendRequest.findMany({
            where: {
              senderId: userId,
              status: 'PENDING',
            },
            select: { receiverId: true },
          }),
          this.prisma.friendRequest.findMany({
            where: {
              receiverId: userId,
              status: 'PENDING',
            },
            select: { id: true, senderId: true },
          }),
          this.prisma.block.findMany({
            where: {
              OR: [{ blockerId: userId }, { blockedId: userId }],
            },
            select: { blockerId: true, blockedId: true },
          }),
        ]);

        const friendIdSet = new Set<string>();
        for (const f of friendships) {
          if (f.userAId === userId) friendIdSet.add(f.userBId);
          if (f.userBId === userId) friendIdSet.add(f.userAId);
        }

        const sentRequestSet = new Set(sentRequests.map((r) => r.receiverId));

        const receivedRequestMap = new Map<string, string>();
        for (const r of receivedRequests) {
          receivedRequestMap.set(r.senderId, r.id);
        }

        const blockedSet = new Set<string>();
        for (const b of blocks) {
          if (b.blockerId === userId) blockedSet.add(b.blockedId);
          if (b.blockedId === userId) blockedSet.add(b.blockerId);
        }

        const data = {
          friendIdSet,
          sentRequestSet,
          receivedRequestMap,
          blockedSet,
        };

        this.userRelationshipsCache.set(userId, { data, expiresAt: Date.now() + 6000 });
        return data;
      } finally {
        this.inFlightRelationships.delete(userId);
      }
    })();

    this.inFlightRelationships.set(userId, promise);
    return promise;
  }

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
      include: {
        sender: {
          select: { username: true, avatar: true },
        },
      },
    });

    // Create persistent in-app notification for receiver
    const senderName = request.sender?.username || 'A user';
    await this.notifications.createNotification({
      userId: receiverId,
      type: 'FRIEND_REQUEST',
      title: 'New Friend Request',
      body: `${senderName} sent you a friend request.`,
      data: { senderId, requestId: request.id },
    });

    this.invalidateUserRelationships(senderId);
    this.invalidateUserRelationships(receiverId);

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

    // Notify sender that their request was accepted
    const receiver = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const receiverName = receiver?.username || 'Your friend';
    await this.notifications.createNotification({
      userId: request.senderId,
      type: 'FRIEND_ACCEPTED',
      title: 'Friend Request Accepted',
      body: `${receiverName} accepted your friend request!`,
      data: { friendId: userId, chatId: result.chat.id },
    });

    this.invalidateUserRelationships(request.senderId);
    this.invalidateUserRelationships(userId);

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

    this.invalidateUserRelationships(request.senderId);
    this.invalidateUserRelationships(userId);

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
    const now = Date.now();
    const cached = this.friendsCache.get(userId);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }

    const inFlight = this.inFlightFriends.get(userId);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      try {
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

        const friendIds = friendships.map((f) =>
          f.userAId === userId ? f.userB.id : f.userA.id,
        );

        let onlineSet = new Set<string>();
        if (this.batchPresenceChecker && friendIds.length > 0) {
          try {
            onlineSet = await this.batchPresenceChecker(friendIds);
          } catch {}
        }

        const results = friendships.map((friendship) => {
          const friend =
            friendship.userAId === userId
              ? friendship.userB
              : friendship.userA;

          const isOnline = onlineSet.has(friend.id);

          return {
            friendshipId: friendship.id,
            createdAt: friendship.createdAt,
            chatId: friendship.chatId,
            friend: {
              ...friend,
              isOnline,
            },
          };
        });

        this.friendsCache.set(userId, { data: results, expiresAt: Date.now() + 5000 });
        return results;
      } finally {
        this.inFlightFriends.delete(userId);
      }
    })();

    this.inFlightFriends.set(userId, promise);
    return promise;
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

    this.invalidateUserRelationships(userId);
    this.invalidateUserRelationships(friendId);

    return {
      message: 'Friend removed',
    };
  }

  // ==========================================
  // SEARCH USERS / FRIENDS
  // ==========================================

  async searchUsers(currentUserId: string, query: string) {
    const trimmed = (query || '').trim().replace(/^@/, '').trim();
    if (!trimmed) {
      return [];
    }

    // 1. Fetch potential matching users (exclude current user, banned users, limit to 20)
    const matchingUsers = await this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        isBanned: false,
        username: {
          contains: trimmed,
          mode: 'insensitive',
        },
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
        lastSeenAt: true,
      },
      take: 20,
    });

    if (matchingUsers.length === 0) {
      return [];
    }

    const candidateIds = matchingUsers.map((u) => u.id);

    // 2. Fetch existing friendships
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: currentUserId, userBId: { in: candidateIds } },
          { userBId: currentUserId, userAId: { in: candidateIds } },
        ],
      },
      select: {
        userAId: true,
        userBId: true,
      },
    });

    const friendIdSet = new Set<string>();
    for (const f of friendships) {
      if (f.userAId === currentUserId) friendIdSet.add(f.userBId);
      if (f.userBId === currentUserId) friendIdSet.add(f.userAId);
    }

    // 3. Fetch pending friend requests
    const sentRequests = await this.prisma.friendRequest.findMany({
      where: {
        senderId: currentUserId,
        receiverId: { in: candidateIds },
        status: 'PENDING',
      },
      select: { receiverId: true },
    });
    const sentRequestSet = new Set(sentRequests.map((r) => r.receiverId));

    const receivedRequests = await this.prisma.friendRequest.findMany({
      where: {
        senderId: { in: candidateIds },
        receiverId: currentUserId,
        status: 'PENDING',
      },
      select: { id: true, senderId: true },
    });
    const receivedRequestMap = new Map<string, string>();
    for (const r of receivedRequests) {
      receivedRequestMap.set(r.senderId, r.id);
    }

    // 4. Fetch blocks between users
    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: { in: candidateIds } },
          { blockerId: { in: candidateIds }, blockedId: currentUserId },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blockedSet = new Set<string>();
    for (const b of blocks) {
      if (b.blockerId === currentUserId) blockedSet.add(b.blockedId);
      if (b.blockedId === currentUserId) blockedSet.add(b.blockerId);
    }

    // 5. Map presence and relationship status
    const results = await Promise.all(
      matchingUsers.map(async (u) => {
        let isOnline = false;
        if (this.presenceChecker) {
          try {
            isOnline = await this.presenceChecker(u.id);
          } catch {
            isOnline = false;
          }
        }

        let relationshipStatus: 'none' | 'friends' | 'pending_sent' | 'pending_received' | 'blocked' = 'none';
        let incomingRequestId: string | undefined = undefined;

        if (blockedSet.has(u.id)) {
          relationshipStatus = 'blocked';
        } else if (friendIdSet.has(u.id)) {
          relationshipStatus = 'friends';
        } else if (sentRequestSet.has(u.id)) {
          relationshipStatus = 'pending_sent';
        } else if (receivedRequestMap.has(u.id)) {
          relationshipStatus = 'pending_received';
          incomingRequestId = receivedRequestMap.get(u.id);
        }

        return {
          id: u.id,
          username: u.username,
          age: u.age,
          gender: u.gender,
          avatar: u.avatar,
          language: u.language,
          interests: u.interests,
          goal: u.goal,
          lastSeenAt: u.lastSeenAt,
          isOnline,
          relationshipStatus,
          incomingRequestId,
        };
      }),
    );

    return results;
  }

  // ==========================================
  // DISCOVER USERS (SEARCH + FILTERS + PRESENCE)
  // ==========================================

  async discoverUsers(params: {
    currentUserId: string;
    query?: string;
    onlineOnly?: boolean;
    gender?: string;
    interests?: string[];
    limit?: number;
    offset?: number;
  }) {
    const { currentUserId, query, onlineOnly, gender, interests, limit = 20, offset = 0 } = params;

    const trimmed = (query || '').trim().replace(/^@/, '').trim();
    const whereClause: any = {
      id: { not: currentUserId },
      isBanned: false,
    };

    // 1. Text search on username
    if (trimmed) {
      whereClause.username = {
        contains: trimmed,
        mode: 'insensitive',
      };
    }

    // 2. Gender filter
    if (gender && gender.toLowerCase() !== 'any' && gender.toLowerCase() !== 'all') {
      whereClause.gender = {
        equals: gender,
        mode: 'insensitive',
      };
    }

    // 3. Interests filter
    if (interests && Array.isArray(interests) && interests.length > 0) {
      const searchTerms = new Set<string>();
      for (const i of interests) {
        if (!i || typeof i !== 'string') continue;
        const raw = i.trim();
        const canon = normalizeInterest(raw);
        if (raw) searchTerms.add(raw);
        if (canon) searchTerms.add(canon);
        if (raw) searchTerms.add(raw.toLowerCase());
        if (canon) searchTerms.add(canon.toLowerCase());
      }
      if (searchTerms.size > 0) {
        whereClause.interests = {
          hasSome: Array.from(searchTerms),
        };
      }
    }

    // Fetch users (if onlineOnly is requested, fetch a slightly larger batch to filter online users)
    const fetchLimit = onlineOnly ? Math.max(limit * 3, 60) : limit;

    // Run user query and relationship query in parallel for reduced round-trips
    const [matchingUsers, relationships] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          username: true,
          age: true,
          gender: true,
          avatar: true,
          language: true,
          interests: true,
          goal: true,
          lastSeenAt: true,
        },
        skip: offset,
        take: fetchLimit,
        orderBy: {
          lastSeenAt: 'desc',
        },
      }),
      currentUserId
        ? this.getUserRelationships(currentUserId)
        : Promise.resolve({
            friendIdSet: new Set<string>(),
            sentRequestSet: new Set<string>(),
            receivedRequestMap: new Map<string, string>(),
            blockedSet: new Set<string>(),
          }),
    ]);

    if (matchingUsers.length === 0) {
      return [];
    }

    const candidateIds = matchingUsers.map((u) => u.id);

    const { friendIdSet, sentRequestSet, receivedRequestMap, blockedSet } = relationships;

    // Batch presence check via single Redis pipeline
    let onlineSet = new Set<string>();
    if (this.batchPresenceChecker && candidateIds.length > 0) {
      try {
        onlineSet = await this.batchPresenceChecker(candidateIds);
      } catch {}
    }

    // Map presence and relationship status synchronously
    const mappedResults = matchingUsers.map((u) => {
      const isOnline = onlineSet.has(u.id);

      let relationshipStatus: 'none' | 'friends' | 'pending_sent' | 'pending_received' | 'blocked' = 'none';
      let incomingRequestId: string | undefined = undefined;

      if (blockedSet.has(u.id)) {
        relationshipStatus = 'blocked';
      } else if (friendIdSet.has(u.id)) {
        relationshipStatus = 'friends';
      } else if (sentRequestSet.has(u.id)) {
        relationshipStatus = 'pending_sent';
      } else if (receivedRequestMap.has(u.id)) {
        relationshipStatus = 'pending_received';
        incomingRequestId = receivedRequestMap.get(u.id);
      }

      return {
        id: u.id,
        username: u.username,
        age: u.age,
        gender: u.gender,
        avatar: u.avatar,
        language: u.language,
        interests: u.interests,
        goal: u.goal,
        lastSeenAt: u.lastSeenAt,
        isOnline,
        relationshipStatus,
        incomingRequestId,
      };
    });

    // If online-only filter is requested, filter out offline users
    const finalResults = onlineOnly
      ? mappedResults.filter((u) => u.isOnline).slice(0, limit)
      : mappedResults.slice(0, limit);

    return finalResults;
  }
}