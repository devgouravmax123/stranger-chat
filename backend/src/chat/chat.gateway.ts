import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UsersService } from '../users/users.service.js';
import { FriendsService } from '../friends/friends.service.js';
import { MatchingService, MatchPreferences } from './matching.service.js';
import { SessionTokenService } from '../auth/session-token.service.js';
import { corsOptions } from '../common/cors.config.js';
import {
  BackendE2EEMessageEnvelope,
  BackendE2EEMediaEnvelope,
  BackendE2EEMediaV1Envelope,
  BackendE2EEMediaV2Envelope,
  BackendE2EEAnyEnvelope,
  isValidE2EEEnvelope,
  isValidE2EEMediaEnvelope,
  isValidE2EEMediaV1Envelope,
  isValidE2EEMediaV2Envelope,
  parseE2EEEnvelope,
  parseE2EEMediaEnvelope,
  parseE2EEAnyEnvelope,
} from './dto/e2ee-envelope.dto.js';

interface WaitingUser {
  socket: Socket;
  preferences: MatchPreferences;
}

interface UserProfile {
  id: string;
  username: string | null;
  age: number | null;
  gender: string | null;
  avatar: string | null;
  language: string | null;
  interests: string[];
  goal: string | null;
  publicKey?: string | null;
}

interface SendMessageDto {
  text?: string;
  envelope?: BackendE2EEAnyEnvelope;
  clientId?: string;
  replyToId?: string;
}

interface SendFriendMessageDto {
  roomId: string;
  senderId?: string;
  text?: string;
  envelope?: BackendE2EEAnyEnvelope;
  replyToId?: string;
  clientId?: string;
}

interface VoiceMessageData {
  audioData: string;
  clientId?: string;
  replyToId?: string;
}

interface FriendVoiceMessageData {
  roomId: string;
  senderId?: string;
  clientId?: string;
  audioData: string;
  replyToId?: string;
}

interface ImageMessageData {
  imageData: string;
  text?: string;
  clientId?: string;
  replyToId?: string;
}

interface FriendImageMessageData {
  roomId: string;
  senderId?: string;
  clientId?: string;
  imageData: string;
  text?: string;
  replyToId?: string;
}

export interface ActiveCallSession {
  callId: string;
  roomId: string;
  chatType?: 'friend' | 'stranger';
  callerId: string;
  receiverId?: string;
  status: 'calling' | 'connected' | 'ended';
  startedAt?: number;
  updatedAt: number;
}

@WebSocketGateway({
  cors: corsOptions,
  maxHttpBufferSize: 1e7,
})
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  // In-memory fallback structures when Redis is offline
  private inMemoryWaitingUsers: WaitingUser[] = [];
  private inMemoryUserRooms = new Map<string, string>();
  private inMemorySocketUsers = new Map<string, string>();
  private inMemoryUserSockets = new Map<string, Set<string>>();
  private inMemorySocketChats = new Map<string, string>();
  private inMemoryUserPreferences = new Map<string, MatchPreferences>();
  private inMemoryActiveCallSessions = new Map<string, ActiveCallSession>();
  private inMemoryUserActiveCalls = new Map<string, string>();
  private inMemoryUserActiveMatches = new Map<string, { roomId: string; chatId: string; peerUserId: string; score: number; createdAt: number }>();
  private inMemoryDisconnectGraceTimers = new Map<string, NodeJS.Timeout>();
  private knownUserIdsCache = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly usersService: UsersService,
    private readonly friendsService: FriendsService,
    private readonly matchingService: MatchingService,
    private readonly sessionTokenService: SessionTokenService,
  ) {}

  getActiveCallForUser(userId: string): ActiveCallSession | null {
    if (!userId) return null;
    const callId = this.inMemoryUserActiveCalls.get(userId);
    if (!callId) return null;
    const session = this.inMemoryActiveCallSessions.get(callId);
    if (!session) {
      this.inMemoryUserActiveCalls.delete(userId);
      return null;
    }
    const now = Date.now();
    // Prune expired sessions (unanswered call > 45s, or long call > 4h)
    if (session.status === 'calling' && now - session.updatedAt > 45000) {
      this.clearActiveCallSession(session.callId);
      return null;
    }
    if (session.status === 'connected' && now - session.updatedAt > 4 * 60 * 60 * 1000) {
      this.clearActiveCallSession(session.callId);
      return null;
    }
    return session;
  }

  getActiveCallForRoom(roomId: string): ActiveCallSession | null {
    if (!roomId) return null;
    for (const s of Array.from(this.inMemoryActiveCallSessions.values())) {
      if (s.roomId === roomId) {
        return s;
      }
    }
    return null;
  }

  registerActiveCallSession(session: ActiveCallSession) {
    this.inMemoryActiveCallSessions.set(session.callId, session);
    this.inMemoryUserActiveCalls.set(session.callerId, session.callId);
    if (session.receiverId) {
      this.inMemoryUserActiveCalls.set(session.receiverId, session.callId);
    }
  }

  clearActiveCallSession(callId?: string, roomId?: string, userId?: string) {
    if (callId) {
      const session = this.inMemoryActiveCallSessions.get(callId);
      if (session) {
        this.inMemoryUserActiveCalls.delete(session.callerId);
        if (session.receiverId) {
          this.inMemoryUserActiveCalls.delete(session.receiverId);
        }
        this.inMemoryActiveCallSessions.delete(callId);
      }
    }
    if (userId) {
      const uCallId = this.inMemoryUserActiveCalls.get(userId);
      if (uCallId) {
        this.clearActiveCallSession(uCallId);
      }
    }
    if (roomId) {
      for (const [sCallId, s] of Array.from(this.inMemoryActiveCallSessions.entries())) {
        if (s.roomId === roomId) {
          this.clearActiveCallSession(sCallId);
        }
      }
    }
  }

  // ==========================================
  // AUTHORITATIVE ACTIVE STRANGER SESSION HELPERS
  // ==========================================

  async getUserActiveSession(userId: string): Promise<{
    roomId: string;
    chatId: string;
    peerUserId: string;
    score: number;
    createdAt: number;
  } | null> {
    if (!userId) return null;
    let match = this.inMemoryUserActiveMatches.get(userId) || null;
    if (!match && typeof this.redis?.getUserActiveMatch === 'function') {
      try {
        match = await this.redis.getUserActiveMatch(userId);
        if (match) {
          this.inMemoryUserActiveMatches.set(userId, match);
        }
      } catch {}
    }
    return match;
  }

  async setUserActiveSession(userId: string, data: {
    roomId: string;
    chatId: string;
    peerUserId: string;
    score: number;
    createdAt?: number;
  }): Promise<void> {
    if (!userId) return;
    const sessionData = {
      ...data,
      createdAt: data.createdAt ?? Date.now(),
    };
    this.inMemoryUserActiveMatches.set(userId, sessionData);
    if (typeof this.redis?.setUserActiveMatch === 'function') {
      try {
        await this.redis.setUserActiveMatch(userId, sessionData);
      } catch {}
    }
  }

  async removeUserActiveSession(userId: string): Promise<void> {
    if (!userId) return;
    this.inMemoryUserActiveMatches.delete(userId);
    this.cancelDisconnectGraceTimer(userId);
    if (typeof this.redis?.removeUserActiveMatch === 'function') {
      try {
        await this.redis.removeUserActiveMatch(userId);
      } catch {}
    }
  }

  cancelDisconnectGraceTimer(userId: string): void {
    if (!userId) return;
    const timer = this.inMemoryDisconnectGraceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.inMemoryDisconnectGraceTimers.delete(userId);
    }
  }

  afterInit(server: Server) {
    this.notifications.registerNotificationEmitter((userId: string, notification: any) => {
      this.server.to(`user:${userId}`).emit('new_notification', notification);
    });

    this.notifications.registerNotificationReadEmitter(
      (userId: string, data: { readIds?: string[]; unreadCount: number }) => {
        this.server.to(`user:${userId}`).emit('notifications_read', data);
      },
    );

    this.usersService.registerDeletionHook(async (userId: string) => {
      await this.handleUserAccountDeleted(userId);
    });

    this.friendsService.registerPresenceChecker(async (userId: string) => {
      return this.isUserOnline(userId);
    });

    this.friendsService.registerBatchPresenceChecker(async (userIds: string[]) => {
      const onlineSet = new Set<string>();
      const needRedisCheck: string[] = [];
      for (const id of userIds) {
        const socks = this.inMemoryUserSockets.get(id);
        if (socks && socks.size > 0) {
          onlineSet.add(id);
        } else {
          needRedisCheck.push(id);
        }
      }
      if (needRedisCheck.length > 0) {
        const redisOnline = await this.redis.areUsersOnline(needRedisCheck);
        for (const id of redisOnline) {
          onlineSet.add(id);
        }
      }
      return onlineSet;
    });
  }

  // ==========================================
  // MULTI-SOCKET PRESENCE HELPERS
  // ==========================================

  async isUserOnline(userId: string): Promise<boolean> {
    const sockets = this.inMemoryUserSockets.get(userId);
    if (sockets && sockets.size > 0) return true;
    return await this.redis.isUserOnline(userId);
  }

  async recordUserOnline(socket: Socket, userId: string) {
    socket.join(`user:${userId}`);
    this.inMemorySocketUsers.set(socket.id, userId);

    let sockets = this.inMemoryUserSockets.get(userId);
    if (!sockets) {
      sockets = new Set<string>();
      this.inMemoryUserSockets.set(userId, sockets);
    }
    const wasOffline = sockets.size === 0;
    sockets.add(socket.id);

    const activeCount = await this.redis.addUserSocketPresence(userId, socket.id);
    await this.redis.setSocketMapping(socket.id, { userId });

    if (wasOffline || activeCount === 1) {
      this.broadcastFriendPresence(userId, true);
    }
  }

  async recordUserDisconnect(socket: Socket) {
    const userId = this.inMemorySocketUsers.get(socket.id);
    if (userId) {
      const sockets = this.inMemoryUserSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.inMemoryUserSockets.delete(userId);
        }
      }
      this.inMemorySocketUsers.delete(socket.id);

      const remaining = await this.redis.removeUserSocketPresence(userId, socket.id);
      const remainingInMemory = this.inMemoryUserSockets.get(userId)?.size || 0;

      if (remaining === 0 && remainingInMemory === 0) {
        const lastSeenAt = new Date();
        await this.prisma.user.update({
          where: { id: userId },
          data: { lastSeenAt },
        }).catch(() => null);

        this.broadcastFriendPresence(userId, false, lastSeenAt);
      }
    }
  }

  async broadcastFriendPresence(userId: string, isOnline: boolean, lastSeenAt?: Date) {
    try {
      const friendships = await this.prisma.friendship.findMany({
        where: {
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        select: { userAId: true, userBId: true },
      });

      const payload = {
        userId,
        isOnline,
        lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : new Date().toISOString(),
      };

      for (const f of friendships) {
        const friendId = f.userAId === userId ? f.userBId : f.userAId;
        this.server.to(`user:${friendId}`).emit('friend_status_changed', payload);
      }
    } catch (err) {
      console.warn('[Presence] Could not broadcast friend presence:', err);
    }
  }

  async handleUserAccountDeleted(userId: string) {
    // 1. Tear down any active video call involving this user and notify peer immediately
    const activeCall = this.getActiveCallForUser(userId);
    if (activeCall) {
      const callPayload = {
        roomId: activeCall.roomId,
        callId: activeCall.callId,
        reason: 'account_deleted',
      };

      // Notify the active room
      this.server.to(activeCall.roomId).emit('video_call_ended', callPayload);

      // In friend video calls, also notify the peer directly
      const peerUserId = activeCall.callerId === userId ? activeCall.receiverId : activeCall.callerId;
      if (peerUserId) {
        this.server.to(`user:${peerUserId}`).emit('video_call_ended', callPayload);
      }

      this.clearActiveCallSession(activeCall.callId, activeCall.roomId, userId);
    }

    // 2. Disconnect all active sockets for this user
    const sockets = this.inMemoryUserSockets.get(userId);
    if (sockets) {
      for (const socketId of Array.from(sockets)) {
        const sock = this.server.sockets.sockets.get(socketId);
        if (sock) {
          const roomId = this.inMemoryUserRooms.get(socketId);
          if (roomId) {
            sock.to(roomId).emit('stranger_left', { roomId });
            sock.leave(roomId);
          }
          sock.disconnect(true);
        }
      }
      this.inMemoryUserSockets.delete(userId);
    }
    this.broadcastFriendPresence(userId, false);
  }

  // ==========================================
  // CONNECTION
  // ==========================================

  async handleConnection(socket: Socket) {
    console.log('User connected:', socket.id);

    const userId = await this.getUserId(socket);

    if (userId) {
      this.cancelDisconnectGraceTimer(userId);
      await this.recordUserOnline(socket, userId);
      const token = this.sessionTokenService.signToken(userId);
      socket.emit('user_ready', { userId, token });
      console.log('User ready:', userId);

      // Check whether user has an active stranger session to restore (e.g. after refresh/reconnect)
      try {
        const activeMatch = await this.getUserActiveSession(userId);
        if (activeMatch && activeMatch.roomId && activeMatch.chatId) {
          const chat = await this.prisma.chat.findUnique({
            where: { id: activeMatch.chatId },
            select: { endedAt: true },
          });

          if (!chat || chat.endedAt) {
            // Match has genuinely ended in DB, clean up stale session
            await this.removeUserActiveSession(userId);
          } else {
            // Restore active session for this new socket
            socket.join(activeMatch.roomId);
            this.inMemoryUserRooms.set(socket.id, activeMatch.roomId);
            this.inMemorySocketChats.set(socket.id, activeMatch.chatId);

            if (this.redis.getIsConnected()) {
              await this.redis.setSocketMapping(socket.id, {
                userId,
                roomId: activeMatch.roomId,
                chatId: activeMatch.chatId,
              });
              await this.redis.setPresence(socket.id, 'chatting');
            }

            const [messages, strangerProfile] = await Promise.all([
              this.getFormattedMessages(activeMatch.chatId, userId),
              this.getUserProfile(activeMatch.peerUserId),
            ]);

            socket.emit('matched', {
              roomId: activeMatch.roomId,
              chatId: activeMatch.chatId,
              userId,
              strangerUserId: activeMatch.peerUserId,
              score: activeMatch.score,
              strangerProfile,
            });
            socket.emit('chat_history', { messages, userId });

            this.server.to(activeMatch.roomId).emit('stranger_online');
            console.log(`[Session Restore] Restored active stranger session in room ${activeMatch.roomId} for user ${userId}`);
          }
        }
      } catch (restoreErr) {
        console.warn(`[Session Restore] Error restoring session for user ${userId}:`, restoreErr);
      }
    } else {
      socket.emit('auth_error', {
        message: 'Authentication failed: invalid, expired, or missing session token for user identity',
      });
      setTimeout(() => {
        socket.disconnect(true);
      }, 50);
    }
  }

  @SubscribeMessage('friend_online')
  async handleFriendOnline(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { userId: string },
  ) {
    if (!data?.userId) return;
    await this.recordUserOnline(socket, data.userId);
  }

  @SubscribeMessage('leave_friend_room')
  async handleLeaveFriendRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!data?.roomId) return;
    const activeCall = this.getActiveCallForRoom(data.roomId);
    if (activeCall) {
      this.clearActiveCallSession(activeCall.callId);
      socket.to(data.roomId).emit('video_call_ended', {
        roomId: data.roomId,
        callId: activeCall.callId,
      });
    }
    socket.leave(data.roomId);
    this.inMemoryUserRooms.delete(socket.id);
    this.inMemorySocketChats.delete(socket.id);
    if (this.redis.getIsConnected()) {
      await this.redis.setSocketMapping(socket.id, { roomId: undefined, chatId: undefined });
    }
  }

  // ==========================================
  // FIND STRANGER / MATCHMAKING
  // ==========================================

  @SubscribeMessage('find_stranger')
  async findStranger(
    @ConnectedSocket() socket: Socket,
    @MessageBody() preferences: MatchPreferences,
  ) {
    // Rate limit matching requests (max 3 per 5 sec)
    const isAllowed = await this.redis.checkRateLimit(socket.id, 'find_stranger', 3, 5);
    if (!isAllowed) {
      socket.emit('rate_limit_exceeded', {
        message: "You're searching too quickly. Please wait a moment.",
      });
      return;
    }

    const userId = await this.getUserId(socket);
    if (!userId) return;

    const currentUserProfile = await this.getUserProfile(userId);

    const cleanPreferences: MatchPreferences = {
      language: preferences?.language || currentUserProfile?.language || 'English',
      interests:
        Array.isArray(preferences?.interests) && preferences.interests.length > 0
          ? preferences.interests
          : currentUserProfile?.interests || [],
      goal: preferences?.goal || currentUserProfile?.goal || 'casual-chat',
    };

    // Get list of ineligible (blocked or reported) user IDs for current user
    const ineligibleUserIds = await this.getIneligibleUserIds(userId);

    // MULTI-TAB ENFORCEMENT: Authenticated user may have at most ONE active stranger match globally
    const existingActiveSession = await this.getUserActiveSession(userId);
    if (existingActiveSession && existingActiveSession.roomId && existingActiveSession.chatId) {
      const activeChat = await this.prisma.chat.findUnique({
        where: { id: existingActiveSession.chatId },
        select: { endedAt: true },
      });

      if (activeChat && !activeChat.endedAt) {
        socket.emit('already_in_match', {
          message: 'You are already in match',
        });
        return;
      } else {
        // Chat was already ended, clean up stale session state
        await this.removeUserActiveSession(userId);
      }
    }

    // Clean up any stale active room for this specific socket before initiating new matchmaking
    const currentContext = await this.getSocketContext(socket);
    if (currentContext.roomId) {
      console.log(`[Matchmaking] Cleaning up active room ${currentContext.roomId} for socket ${socket.id}`);
      await this.leaveChat(socket, 'ended');
    }

    // REDIS MATCHMAKING MODE
    if (this.redis.getIsConnected()) {
      await this.redis.setPresence(socket.id, 'searching');

      type WaitingCandidate = {
        socketId: string;
        userId: string;
        preferences: any;
        createdAt: number;
      };

      let waitingCandidate: WaitingCandidate | null = null;
      const unmatchableCandidates: WaitingCandidate[] = [];

      while (true) {
        const candidate = await this.redis.popWaitingUser();
        if (!candidate) break;

        const candidateSocket = this.server.sockets.sockets.get(candidate.socketId);
        // Ensure connected socket
        if (!candidateSocket || !candidateSocket.connected) {
          // Socket no longer connected, drop candidate
          continue;
        }

        // Same socket or user cannot match self
        if (candidate.socketId === socket.id || candidate.userId === userId) {
          unmatchableCandidates.push(candidate);
          continue;
        }

        // Ineligible (blocked or reported) user check
        if (ineligibleUserIds.has(candidate.userId)) {
          unmatchableCandidates.push(candidate);
          continue;
        }

        waitingCandidate = candidate;
        break;
      }

      // Re-push valid candidates that couldn't match this particular user
      for (const item of unmatchableCandidates) {
        if (item && item.socketId !== socket.id) {
          await this.redis.pushWaitingUser(item);
        }
      }

      if (!waitingCandidate) {
        await this.redis.pushWaitingUser({
          socketId: socket.id,
          userId,
          preferences: cleanPreferences,
          createdAt: Date.now(),
        });

        socket.emit('waiting');
        console.log(`[Matchmaking] User ${userId} (${socket.id}) added to Redis waiting queue`);
        setTimeout(() => this.sweepWaitingQueue(), 50);
        return;
      }

      const strangerSocket = this.server.sockets.sockets.get(waitingCandidate.socketId)!;
      const strangerUserId = waitingCandidate.userId;
      const strangerPreferences = waitingCandidate.preferences;

      await this.createAndEmitMatch(
        strangerSocket,
        strangerUserId,
        strangerPreferences,
        socket,
        userId,
        cleanPreferences,
      );
      return;
    }

    // IN-MEMORY FALLBACK MATCHMAKING MODE
    this.inMemoryUserPreferences.set(socket.id, cleanPreferences);

    // Clean any dead or self entries from waiting list
    this.inMemoryWaitingUsers = this.inMemoryWaitingUsers.filter(
      (wu) => wu.socket && wu.socket.connected && wu.socket.id !== socket.id,
    );

    // Look for a compatible stranger among waiting users
    let matchIndex = -1;
    for (let i = 0; i < this.inMemoryWaitingUsers.length; i++) {
      const candidate = this.inMemoryWaitingUsers[i];
      const candidateUserId = this.inMemorySocketUsers.get(candidate.socket.id);
      if (
        candidateUserId &&
        candidateUserId !== userId &&
        !ineligibleUserIds.has(candidateUserId)
      ) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      this.inMemoryWaitingUsers.push({ socket, preferences: cleanPreferences });
      socket.emit('waiting');
      console.log(`[Matchmaking] User ${userId} (${socket.id}) added to in-memory waiting list`);
      return;
    }

    const [waitingUser] = this.inMemoryWaitingUsers.splice(matchIndex, 1);
    const stranger = waitingUser.socket;
    const strangerUserId = this.inMemorySocketUsers.get(stranger.id)!;

    const score = this.matchingService.calculateMatchScore(cleanPreferences, waitingUser.preferences);
    const roomId = `${stranger.id}-${socket.id}`;

    stranger.join(roomId);
    socket.join(roomId);

    this.inMemoryUserRooms.set(stranger.id, roomId);
    this.inMemoryUserRooms.set(socket.id, roomId);

    const chat = await this.prisma.chat.create({
      data: {
        userAId: strangerUserId,
        userBId: userId,
      },
    });

    this.inMemorySocketChats.set(stranger.id, chat.id);
    this.inMemorySocketChats.set(socket.id, chat.id);

    // Register authoritative active match session for both users
    await Promise.all([
      this.setUserActiveSession(strangerUserId, { roomId, chatId: chat.id, peerUserId: userId, score }),
      this.setUserActiveSession(userId, { roomId, chatId: chat.id, peerUserId: strangerUserId, score }),
    ]);

    const messages = await this.getFormattedMessages(chat.id, userId);
    const strangerMessages = await this.getFormattedMessages(chat.id, strangerUserId);

    stranger.emit('chat_history', { messages: strangerMessages, userId: strangerUserId });
    socket.emit('chat_history', { messages, userId });

    const strangerProfile = await this.getUserProfile(strangerUserId);
    const userProfile = await this.getUserProfile(userId);

    stranger.emit('matched', {
      roomId,
      chatId: chat.id,
      userId: strangerUserId,
      strangerUserId: userId,
      score,
      strangerProfile: userProfile,
    });

    socket.emit('matched', {
      roomId,
      chatId: chat.id,
      userId,
      strangerUserId,
      score,
      strangerProfile,
    });

    this.server.to(roomId).emit('stranger_online');
  }

  private async createAndEmitMatch(
    sockA: Socket,
    userAId: string,
    prefsA: MatchPreferences,
    sockB: Socket,
    userBId: string,
    prefsB: MatchPreferences,
  ) {
    const score = this.matchingService.calculateMatchScore(prefsA, prefsB);
    const roomId = `${sockA.id}-${sockB.id}`;

    sockA.join(roomId);
    sockB.join(roomId);

    const chat = await this.prisma.chat.create({
      data: {
        userAId,
        userBId,
      },
    });

    this.inMemoryUserRooms.set(sockA.id, roomId);
    this.inMemorySocketChats.set(sockA.id, chat.id);
    this.inMemoryUserRooms.set(sockB.id, roomId);
    this.inMemorySocketChats.set(sockB.id, chat.id);

    await Promise.all([
      this.redis.setMatchState(roomId, {
        userAId,
        userASocketId: sockA.id,
        userBId,
        userBSocketId: sockB.id,
        chatId: chat.id,
        createdAt: Date.now(),
      }),
      this.redis.setSocketMapping(sockA.id, {
        userId: userAId,
        roomId,
        chatId: chat.id,
      }),
      this.redis.setSocketMapping(sockB.id, {
        userId: userBId,
        roomId,
        chatId: chat.id,
      }),
      this.redis.setPresence(sockA.id, 'chatting'),
      this.redis.setPresence(sockB.id, 'chatting'),
      this.setUserActiveSession(userAId, { roomId, chatId: chat.id, peerUserId: userBId, score }),
      this.setUserActiveSession(userBId, { roomId, chatId: chat.id, peerUserId: userAId, score }),
    ]);

    // Newly created stranger chat has no prior messages - emit [] without DB query
    sockA.emit('chat_history', { messages: [], userId: userAId });
    sockB.emit('chat_history', { messages: [], userId: userBId });

    const [profileA, profileB] = await Promise.all([
      this.getUserProfile(userAId),
      this.getUserProfile(userBId),
    ]);

    console.log(`[Matchmaking] Matched users via Redis: ${userBId} & ${userAId} in room ${roomId}`);

    sockA.emit('matched', {
      roomId,
      chatId: chat.id,
      userId: userAId,
      strangerUserId: userBId,
      score,
      strangerProfile: profileB,
    });

    sockB.emit('matched', {
      roomId,
      chatId: chat.id,
      userId: userBId,
      strangerUserId: userAId,
      score,
      strangerProfile: profileA,
    });

    this.server.to(roomId).emit('stranger_online');
  }

  private async getIneligibleUserIds(userId: string): Promise<Set<string>> {
    const [blocks, reports] = await Promise.all([
      this.prisma.block.findMany({
        where: {
          OR: [{ blockerId: userId }, { blockedId: userId }],
        },
        select: { blockerId: true, blockedId: true },
      }),
      this.prisma.report.findMany({
        where: {
          OR: [{ reporterId: userId }, { reportedId: userId }],
        },
        select: { reporterId: true, reportedId: true },
      }),
    ]);

    const set = new Set<string>();
    for (const b of blocks) {
      set.add(b.blockerId);
      set.add(b.blockedId);
    }
    for (const r of reports) {
      set.add(r.reporterId);
      set.add(r.reportedId);
    }
    set.delete(userId);
    return set;
  }

  private async areUsersIneligible(userAId: string, userBId: string): Promise<boolean> {
    const [block, report] = await Promise.all([
      this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: userAId, blockedId: userBId },
            { blockerId: userBId, blockedId: userAId },
          ],
        },
        select: { id: true },
      }),
      this.prisma.report.findFirst({
        where: {
          OR: [
            { reporterId: userAId, reportedId: userBId },
            { reporterId: userBId, reportedId: userAId },
          ],
        },
        select: { id: true },
      }),
    ]);
    return Boolean(block || report);
  }

  private async sweepWaitingQueue() {
    if (!this.redis.getIsConnected()) return;
    try {
      const qLen = await this.redis.getWaitingQueueLength();
      if (qLen >= 2) {
        const userA = await this.redis.popWaitingUser();
        const userB = await this.redis.popWaitingUser();
        if (userA && userB) {
          const sockA = this.server.sockets.sockets.get(userA.socketId);
          const sockB = this.server.sockets.sockets.get(userB.socketId);
          const areIneligible = await this.areUsersIneligible(userA.userId, userB.userId);
          if (
            sockA &&
            sockA.connected &&
            sockB &&
            sockB.connected &&
            userA.userId !== userB.userId &&
            !areIneligible
          ) {
            await this.createAndEmitMatch(sockA, userA.userId, userA.preferences, sockB, userB.userId, userB.preferences);
          } else {
            if (sockA && sockA.connected) await this.redis.pushWaitingUser(userA);
            if (sockB && sockB.connected) await this.redis.pushWaitingUser(userB);
          }
        } else if (userA) {
          await this.redis.pushWaitingUser(userA);
        }
      }
    } catch (err) {
      console.warn('[Matchmaking] Queue sweep error:', err);
    }
  }

  // ==========================================
  // FEATURE 1 — SKIP / NEXT STRANGER
  // ==========================================

  @SubscribeMessage('skip_stranger')
  async skipStranger(
    @ConnectedSocket() socket: Socket,
    @MessageBody() preferences?: MatchPreferences,
  ) {
    const isAllowed = await this.redis.checkRateLimit(socket.id, 'skip', 3, 10);
    if (!isAllowed) {
      socket.emit('rate_limit_exceeded', {
        message: "You're skipping too fast. Please wait a few seconds.",
      });
      return;
    }

    console.log('User skipped stranger:', socket.id);
    await this.leaveChat(socket, 'skipped');

    // Immediately trigger matchmaking for next stranger using existing or profile preferences
    let cleanPref = preferences;
    if (!cleanPref) {
      const userId = await this.getUserId(socket);
      if (userId) {
        const userProfile = await this.getUserProfile(userId);
        if (userProfile) {
          cleanPref = {
            language: userProfile.language || 'English',
            interests: userProfile.interests || [],
            goal: userProfile.goal || 'casual-chat',
          };
        }
      }
    }
    await this.findStranger(socket, cleanPref!);
  }

  // ==========================================
  // FEATURE 2 — TYPING INDICATORS
  // ==========================================

  @SubscribeMessage('typing_start')
  async handleTypingStart(@ConnectedSocket() socket: Socket) {
    const { roomId } = await this.getSocketContext(socket);
    if (!roomId) return;
    socket.to(roomId).emit('stranger_typing');
  }

  @SubscribeMessage('typing_stop')
  async handleTypingStop(@ConnectedSocket() socket: Socket) {
    const { roomId } = await this.getSocketContext(socket);
    if (!roomId) return;
    socket.to(roomId).emit('stranger_stopped_typing');
  }

  @SubscribeMessage('typing')
  async typing(@ConnectedSocket() socket: Socket) {
    await this.handleTypingStart(socket);
  }

  @SubscribeMessage('stop_typing')
  async stopTyping(@ConnectedSocket() socket: Socket) {
    await this.handleTypingStop(socket);
  }

  // ==========================================
  // FEATURE 4 — MESSAGING & DELIVERY & SEEN
  // ==========================================

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: SendMessageDto,
  ) {
    const isAllowed = await this.redis.checkRateLimit(socket.id, 'send_message', 5, 1);
    if (!isAllowed) {
      socket.emit('rate_limit_exceeded', {
        message: "You're sending messages too quickly. Slow down!",
      });
      return;
    }

    const { roomId, userId, chatId } = await this.getSocketContext(socket);
    if (!roomId || !userId || !chatId) return;

    const chatRecord = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { endedAt: true },
    });
    if (!chatRecord || chatRecord.endedAt) {
      if (data?.clientId) {
        socket.emit('message_error', {
          clientId: data.clientId,
          message: 'Chat has ended',
        });
      }
      return;
    }

    let content: string | null = null;
    let isE2EE = false;
    let validEnvelope: BackendE2EEAnyEnvelope | null = null;

    if (data?.envelope) {
      if (isValidE2EEMediaV2Envelope(data.envelope)) {
        // Validate media attachment in database
        const attachment = await this.prisma.mediaAttachment.findUnique({
          where: { id: data.envelope.mediaId },
        });

        if (
          !attachment ||
          attachment.chatId !== chatId ||
          attachment.senderId !== userId ||
          attachment.messageId !== null ||
          attachment.storageKey !== data.envelope.storageKey
        ) {
          socket.emit('message_error', {
            clientId: data.clientId,
            message: 'Invalid or unauthorized media attachment',
          });
          return;
        }

        validEnvelope = {
          e2ee: true,
          v: 2,
          type: data.envelope.type,
          mediaId: data.envelope.mediaId,
          storageKey: data.envelope.storageKey,
          mime: data.envelope.mime,
          iv: data.envelope.iv,
          fileSize: data.envelope.fileSize,
        };
        content = JSON.stringify(validEnvelope);
        isE2EE = true;
      } else if (isValidE2EEMediaV1Envelope(data.envelope)) {
        validEnvelope = {
          e2ee: true,
          v: 1,
          type: data.envelope.type,
          mime: data.envelope.mime,
          iv: data.envelope.iv,
          ct: data.envelope.ct,
        };
        // Serialize compact media envelope directly without inspecting or decrypting ciphertext
        content = JSON.stringify(validEnvelope);
        isE2EE = true;
      } else if (isValidE2EEEnvelope(data.envelope)) {
        validEnvelope = {
          e2ee: true,
          v: 1,
          iv: data.envelope.iv,
          ct: data.envelope.ct,
        };
        // Serialize compact text envelope directly without inspecting or decrypting ciphertext
        content = JSON.stringify(validEnvelope);
        isE2EE = true;
      } else {
        socket.emit('message_error', {
          clientId: data.clientId,
          message: 'Invalid E2EE message envelope',
        });
        return;
      }
    } else if (data?.text?.trim()) {
      // Legacy plaintext path during transition
      content = data.text.trim();
    } else {
      return;
    }

    const replyToId = data.replyToId || null;

    const message = await this.prisma.message.create({
      data: {
        content,
        chatId,
        senderId: userId,
        replyToId,
        status: 'delivered',
        deliveredAt: new Date(),
      },
      include: {
        replyTo: true,
        reactions: true,
      },
    });

    // If v2 media attachment, link messageId to mediaAttachment
    if (validEnvelope && 'v' in validEnvelope && validEnvelope.v === 2 && 'mediaId' in validEnvelope) {
      await this.prisma.mediaAttachment.update({
        where: { id: validEnvelope.mediaId },
        data: { messageId: message.id },
      });
    }

    // Send ACK to sender
    socket.emit('message_sent', {
      id: message.id,
      clientId: data.clientId,
      timestamp: message.createdAt.getTime(),
      status: 'delivered',
    });

    // Determine replyTo structure without creating server-side plaintext reply previews for E2EE
    let replyToPayload: { id: string; content?: string; text?: string; type?: string } | null = null;
    if (message.replyTo) {
      const isReplyAudio = message.replyTo.content.startsWith('audio:');
      const isReplyImage = message.replyTo.content.startsWith('image:');
      const replyMediaEnv = parseE2EEMediaEnvelope(message.replyTo.content);
      const replyTextEnv = !replyMediaEnv ? parseE2EEEnvelope(message.replyTo.content) : null;

      if (replyMediaEnv) {
        replyToPayload = {
          id: message.replyTo.id,
          content: message.replyTo.content, // Opaque encrypted envelope string
          text: replyMediaEnv.type === 'image' ? 'Encrypted image' : 'Encrypted audio',
          type: replyMediaEnv.type,
        };
      } else if (replyTextEnv) {
        replyToPayload = {
          id: message.replyTo.id,
          content: message.replyTo.content, // Opaque encrypted envelope string
          type: 'text',
        };
      } else {
        replyToPayload = {
          id: message.replyTo.id,
          text: message.replyTo.content,
          type: isReplyAudio ? 'audio' : isReplyImage ? 'image' : 'text',
        };
      }
    }

    // Broadcast to stranger in room
    if (isE2EE && validEnvelope) {
      const isMedia = 'type' in validEnvelope && (validEnvelope.type === 'image' || validEnvelope.type === 'audio');
      const messageType = isMedia ? (validEnvelope as BackendE2EEMediaEnvelope).type : 'text';

      // E2EE path: Emit envelope, DO NOT include text property
      socket.to(roomId).emit('receive_message', {
        id: message.id,
        clientId: data.clientId,
        envelope: validEnvelope,
        senderId: userId,
        timestamp: message.createdAt.getTime(),
        type: messageType,
        status: 'delivered',
        replyTo: replyToPayload,
      });
    } else {
      // Legacy plaintext path
      socket.to(roomId).emit('receive_message', {
        id: message.id,
        clientId: data.clientId,
        text: message.content,
        senderId: userId,
        timestamp: message.createdAt.getTime(),
        type: 'text',
        status: 'delivered',
        replyTo: replyToPayload,
      });
    }

    // Notify sender that message was delivered
    socket.emit('message_delivered', {
      id: message.id,
      clientId: data.clientId,
    });
  }

  @SubscribeMessage('send_voice_message')
  async sendVoiceMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: VoiceMessageData,
  ) {
    const isAllowed = await this.redis.checkRateLimit(socket.id, 'voice', 3, 5);
    if (!isAllowed) {
      socket.emit('rate_limit_exceeded', {
        message: 'Please wait before sending another voice note.',
      });
      if (data?.clientId) {
        socket.emit('voice_message_error', {
          clientId: data.clientId,
          message: "Please wait before sending another voice note.",
        });
      }
      return;
    }

    const { roomId, userId, chatId } = await this.getSocketContext(socket);
    if (!roomId || !userId || !chatId || !data?.audioData || !this.validateAudioPayload(data.audioData)) {
      if (data?.clientId) {
        socket.emit('voice_message_error', {
          clientId: data.clientId,
          message: "Voice note couldn't be sent. Please try again.",
        });
      }
      return;
    }

    const chatRecord = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { endedAt: true },
    });
    if (!chatRecord || chatRecord.endedAt) {
      if (data?.clientId) {
        socket.emit('voice_message_error', {
          clientId: data.clientId,
          message: 'Chat has ended',
        });
      }
      return;
    }

    const content = `audio:${data.audioData}`;
    const replyToId = data.replyToId || null;

    const message = await this.prisma.message.create({
      data: {
        content,
        chatId,
        senderId: userId,
        replyToId,
        status: 'sent',
      },
      include: {
        replyTo: true,
      },
    });

    socket.emit('message_sent', {
      id: message.id,
      clientId: data.clientId,
      timestamp: message.createdAt.getTime(),
      status: 'sent',
    });

    socket.to(roomId).emit('receive_message', {
      id: message.id,
      clientId: data.clientId,
      text: 'Voice message',
      senderId: userId,
      timestamp: message.createdAt.getTime(),
      type: 'audio',
      audioUrl: data.audioData,
      status: 'delivered',
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            text: message.replyTo.content,
            type: message.replyTo.content.startsWith('audio:')
              ? 'audio'
              : message.replyTo.content.startsWith('image:')
              ? 'image'
              : 'text',
          }
        : null,
    });
  }

  @SubscribeMessage('send_image_message')
  async sendImageMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: ImageMessageData,
  ) {
    const isAllowed = await this.redis.checkRateLimit(socket.id, 'image', 3, 5);
    if (!isAllowed) {
      socket.emit('rate_limit_exceeded', {
        message: 'Please wait before sending another photo.',
      });
      return;
    }

    const { roomId, userId, chatId } = await this.getSocketContext(socket);
    if (!roomId || !userId || !chatId || !data?.imageData || !this.validateImagePayload(data.imageData)) {
      if (data?.clientId) {
        socket.emit('image_message_error', {
          clientId: data.clientId,
          message: "Photo couldn't be sent. Please try again.",
        });
      }
      return;
    }

    const chatRecord = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { endedAt: true },
    });
    if (!chatRecord || chatRecord.endedAt) {
      if (data?.clientId) {
        socket.emit('image_message_error', {
          clientId: data.clientId,
          message: 'Chat has ended',
        });
      }
      return;
    }

    const content = `image:${data.imageData}`;
    const replyToId = data.replyToId || null;

    const message = await this.prisma.message.create({
      data: {
        content,
        chatId,
        senderId: userId,
        replyToId,
        status: 'sent',
      },
      include: {
        replyTo: true,
      },
    });

    socket.emit('message_sent', {
      id: message.id,
      clientId: data.clientId,
      timestamp: message.createdAt.getTime(),
      status: 'sent',
    });

    socket.to(roomId).emit('receive_message', {
      id: message.id,
      clientId: data.clientId,
      text: data.text || 'Photo message',
      senderId: userId,
      timestamp: message.createdAt.getTime(),
      type: 'image',
      imageUrl: data.imageData,
      status: 'delivered',
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            text: message.replyTo.content,
            type: message.replyTo.content.startsWith('audio:')
              ? 'audio'
              : message.replyTo.content.startsWith('image:')
              ? 'image'
              : 'text',
          }
        : null,
    });
  }

  @SubscribeMessage('mark_seen')
  async markSeen(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { messageIds?: string[]; chatId?: string; roomId?: string },
  ) {
    const context = await this.getSocketContext(socket);
    let roomId = data?.roomId || context.roomId;
    let chatId = data?.chatId || context.chatId;
    let userId = context.userId;

    if (!userId) {
      userId = (await this.getUserId(socket)) || undefined;
    }

    if (!chatId && data?.messageIds?.length) {
      const firstMsg = await this.prisma.message.findUnique({
        where: { id: data.messageIds[0] },
        select: { chatId: true },
      });
      if (firstMsg) chatId = firstMsg.chatId;
    }

    if (!chatId && roomId && roomId.startsWith('friend-')) {
      const parts = roomId.replace('friend-', '').split('-');
      if (parts.length === 2) {
        const chat = await this.prisma.chat.findFirst({
          where: {
            OR: [
              { userAId: parts[0], userBId: parts[1] },
              { userAId: parts[1], userBId: parts[0] },
            ],
          },
        });
        if (chat) chatId = chat.id;
      }
    }

    if (!chatId && roomId) {
      const matchState = await this.redis.getMatchState(roomId);
      if (matchState?.chatId) {
        chatId = matchState.chatId;
      }
    }

    if (!userId || !chatId) return;

    // Verify conversation membership
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, userAId: true, userBId: true },
    });

    if (!chat || (chat.userAId !== userId && chat.userBId !== userId)) return;

    const otherUserId = chat.userAId === userId ? chat.userBId : chat.userAId;

    // Bulk update unread messages in DB
    const whereClause: any = {
      chatId,
      senderId: otherUserId,
      status: { not: 'seen' },
    };

    if (data?.messageIds && data.messageIds.length > 0) {
      whereClause.id = { in: data.messageIds };
    }

    const updateResult = await this.prisma.message.updateMany({
      where: whereClause,
      data: {
        status: 'seen',
        seenAt: new Date(),
      },
    });

    const seenPayload = {
      chatId,
      messageIds: data?.messageIds || [],
      count: updateResult.count,
    };

    // 1. Notify stranger / friend room if present
    if (roomId) {
      this.server.to(roomId).emit('message_seen', seenPayload);
    }

    // 2. Guaranteed delivery: notify other participant's personal room
    this.server.to(`user:${otherUserId}`).emit('message_seen', seenPayload);

    // 3. Notify caller's personal room
    this.server.to(`user:${userId}`).emit('message_seen', seenPayload);
  }

  // ==========================================
  // FEATURE 5 — REACTIONS & DELETE
  // ==========================================

  @SubscribeMessage('add_reaction')
  async addReaction(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { messageId: string; emoji: string; roomId?: string },
  ) {
    let { roomId: contextRoomId, userId } = await this.getSocketContext(socket);
    if (!userId) {
      userId = (await this.getUserId(socket)) || undefined;
    }
    if (!userId || !data?.messageId || !data?.emoji) return;

    try {
      const message = await this.prisma.message.findUnique({
        where: { id: data.messageId },
        include: { chat: { include: { friendship: true } } },
      });
      if (!message) return;

      const friendRoomId = `friend-${[message.chat.userAId, message.chat.userBId].sort().join('-')}`;
      const roomId =
        data?.roomId ||
        contextRoomId ||
        (message.chat.friendship ? friendRoomId : message.chatId);

      await this.prisma.reaction.upsert({
        where: {
          messageId_userId_emoji: {
            messageId: data.messageId,
            userId,
            emoji: data.emoji,
          },
        },
        create: {
          messageId: data.messageId,
          userId,
          emoji: data.emoji,
        },
        update: {},
      });

      const updatedReactions = await this.prisma.reaction.findMany({
        where: { messageId: data.messageId },
        select: { emoji: true, userId: true },
      });

      if (roomId) {
        this.server.to(roomId).emit('reaction_updated', {
          messageId: data.messageId,
          reactions: updatedReactions,
        });
      }
      if (message.chat.friendship && roomId !== friendRoomId) {
        this.server.to(friendRoomId).emit('reaction_updated', {
          messageId: data.messageId,
          reactions: updatedReactions,
        });
      }
    } catch (err) {
      console.error('Reaction error:', err);
    }
  }

  @SubscribeMessage('remove_reaction')
  async removeReaction(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { messageId: string; emoji: string; roomId?: string },
  ) {
    let { roomId: contextRoomId, userId } = await this.getSocketContext(socket);
    if (!userId) {
      userId = (await this.getUserId(socket)) || undefined;
    }
    if (!userId || !data?.messageId || !data?.emoji) return;

    try {
      const message = await this.prisma.message.findUnique({
        where: { id: data.messageId },
        include: { chat: { include: { friendship: true } } },
      });
      if (!message) return;

      const friendRoomId = `friend-${[message.chat.userAId, message.chat.userBId].sort().join('-')}`;
      const roomId =
        data?.roomId ||
        contextRoomId ||
        (message.chat.friendship ? friendRoomId : message.chatId);

      await this.prisma.reaction.deleteMany({
        where: {
          messageId: data.messageId,
          userId,
          emoji: data.emoji,
        },
      });

      const updatedReactions = await this.prisma.reaction.findMany({
        where: { messageId: data.messageId },
        select: { emoji: true, userId: true },
      });

      if (roomId) {
        this.server.to(roomId).emit('reaction_updated', {
          messageId: data.messageId,
          reactions: updatedReactions,
        });
      }
      if (message.chat.friendship && roomId !== friendRoomId) {
        this.server.to(friendRoomId).emit('reaction_updated', {
          messageId: data.messageId,
          reactions: updatedReactions,
        });
      }
    } catch (err) {
      console.error('Remove reaction error:', err);
    }
  }

  @SubscribeMessage('delete_message')
  async deleteMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { messageId: string; roomId?: string },
  ) {
    let { roomId: contextRoomId, userId } = await this.getSocketContext(socket);
    if (!userId) {
      userId = (await this.getUserId(socket)) || undefined;
    }
    if (!userId || !data?.messageId) return;

    const message = await this.prisma.message.findUnique({
      where: { id: data.messageId },
      include: { chat: { include: { friendship: true } } },
    });

    // Only sender can delete own message
    if (!message || message.senderId !== userId) return;

    const friendRoomId = `friend-${[message.chat.userAId, message.chat.userBId].sort().join('-')}`;
    const roomId =
      data?.roomId ||
      contextRoomId ||
      (message.chat.friendship ? friendRoomId : message.chatId);

    await this.prisma.message.update({
      where: { id: data.messageId },
      data: { deletedAt: new Date() },
    });

    if (roomId) {
      this.server.to(roomId).emit('message_deleted', {
        messageId: data.messageId,
      });
    }
    if (message.chat.friendship && roomId !== friendRoomId) {
      this.server.to(friendRoomId).emit('message_deleted', {
        messageId: data.messageId,
      });
    }
  }

  // ==========================================
  // FEATURE 6 — SAFETY (REPORT & BLOCK)
  // ==========================================

  @SubscribeMessage('report_stranger')
  async reportStranger(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { reportedUserId?: string; reason: string; description?: string },
  ) {
    const { roomId, userId, chatId } = await this.getSocketContext(socket);
    if (!userId || !data?.reason) return;

    let targetUserId = data.reportedUserId;
    if (!targetUserId && roomId) {
      const matchState = await this.redis.getMatchState(roomId);
      if (matchState) {
        targetUserId = matchState.userAId === userId ? matchState.userBId : matchState.userAId;
      }
    }

    if (!targetUserId) {
      socket.emit('report_error', { message: 'Could not identify stranger to report.' });
      return;
    }

    await this.prisma.report.create({
      data: {
        reporterId: userId,
        reportedId: targetUserId,
        reason: data.reason,
        chatId: chatId || null,
      },
    });

    socket.emit('report_submitted', {
      message: 'Report submitted. Thank you for keeping Stranger Chat safe.',
    });
    await this.leaveChat(socket, 'ended');
  }

  @SubscribeMessage('block_stranger')
  async blockStranger(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { blockedUserId?: string },
  ) {
    const { roomId, userId } = await this.getSocketContext(socket);
    if (!userId) return;

    let targetUserId = data?.blockedUserId;
    if (!targetUserId && roomId) {
      const matchState = await this.redis.getMatchState(roomId);
      if (matchState) {
        targetUserId = matchState.userAId === userId ? matchState.userBId : matchState.userAId;
      }
    }

    if (targetUserId) {
      try {
        await this.prisma.block.upsert({
          where: {
            blockerId_blockedId: {
              blockerId: userId,
              blockedId: targetUserId,
            },
          },
          create: {
            blockerId: userId,
            blockedId: targetUserId,
          },
          update: {},
        });
      } catch (err) {}
    }

    socket.emit('stranger_blocked', { message: 'Stranger has been blocked.' });
    await this.leaveChat(socket, 'blocked');
  }

  // ==========================================
  // PRIVATE FRIEND ROOMS
  // ==========================================

  @SubscribeMessage('open_friend_room')
  async openFriendRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { userId: string; friendId: string },
  ) {
    const { userId, friendId } = data;
    if (!userId || !friendId) return;

    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { userAId: userId, userBId: friendId },
          { userAId: friendId, userBId: userId },
        ],
      },
    });

    if (!friendship) {
      socket.emit('friend_room_error', {
        message: 'You are not friends with this user.',
      });
      return;
    }

    const roomId = `friend-${[userId, friendId].sort().join('-')}`;
    socket.join(roomId);

    const friendSocket = [...this.server.sockets.sockets.values()].find(
      (s) => (this.inMemorySocketUsers.get(s.id) || s.id) === friendId,
    );

    if (friendSocket) {
      friendSocket.join(roomId);
    }

    let chat = await this.prisma.chat.findFirst({
      where: {
        OR: [
          { userAId: userId, userBId: friendId },
          { userAId: friendId, userBId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!chat) {
      chat = await this.prisma.chat.create({
        data: { userAId: userId, userBId: friendId },
      });
    }

    if (!friendship.chatId || friendship.chatId !== chat.id) {
      try {
        await this.prisma.friendship.update({
          where: { id: friendship.id },
          data: { chatId: chat.id },
        });
      } catch {}
    }

    const messages = await this.getFormattedMessages(chat.id, userId);

    socket.emit('friend_room_opened', {
      roomId,
      chatId: chat.id,
      friendId,
      messages,
    });

    if (this.redis.getIsConnected()) {
      await this.redis.setSocketMapping(socket.id, { userId, roomId, chatId: chat.id });
      if (friendSocket) {
        await this.redis.setSocketMapping(friendSocket.id, { userId: friendId, roomId, chatId: chat.id });
      }
    } else {
      this.inMemoryUserRooms.set(socket.id, roomId);
      this.inMemorySocketChats.set(socket.id, chat.id);
      if (friendSocket) {
        this.inMemoryUserRooms.set(friendSocket.id, roomId);
        this.inMemorySocketChats.set(friendSocket.id, chat.id);
      }
    }
  }

  @SubscribeMessage('send_friend_message')
  async sendFriendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: SendFriendMessageDto,
  ) {
    const { roomId, replyToId } = data;
    if (!roomId) return;

    // Preserve authenticated identity: prefer authenticated socket context, fallback to data.senderId
    const socketContext = await this.getSocketContext(socket);
    const authenticatedSenderId = socketContext.userId || data.senderId;
    if (!authenticatedSenderId) return;

    let chatId: string | undefined = undefined;
    if (roomId.startsWith('friend-')) {
      const rest = roomId.slice('friend-'.length);
      let targetUserId: string | null = null;
      if (rest.startsWith(authenticatedSenderId + '-')) {
        targetUserId = rest.slice(authenticatedSenderId.length + 1);
      } else if (rest.endsWith('-' + authenticatedSenderId)) {
        targetUserId = rest.slice(0, rest.length - authenticatedSenderId.length - 1);
      }

      if (targetUserId) {
        const chat = await this.prisma.chat.findFirst({
          where: {
            OR: [
              { userAId: authenticatedSenderId, userBId: targetUserId },
              { userAId: targetUserId, userBId: authenticatedSenderId },
            ],
          },
        });
        if (chat) chatId = chat.id;
      }
      if (!chatId) {
        chatId = socketContext.chatId;
      }
    } else {
      chatId = socketContext.chatId;
    }
    if (!chatId) return;

    let content: string | null = null;
    let isE2EE = false;
    let validEnvelope: BackendE2EEAnyEnvelope | null = null;

    if (data?.envelope) {
      if (isValidE2EEMediaV2Envelope(data.envelope)) {
        // Validate media attachment in database
        const attachment = await this.prisma.mediaAttachment.findUnique({
          where: { id: data.envelope.mediaId },
        });

        if (
          !attachment ||
          attachment.chatId !== chatId ||
          attachment.senderId !== authenticatedSenderId ||
          attachment.messageId !== null ||
          attachment.storageKey !== data.envelope.storageKey
        ) {
          socket.emit('friend_message_error', {
            clientId: data.clientId,
            message: 'Invalid or unauthorized media attachment',
          });
          return;
        }

        validEnvelope = {
          e2ee: true,
          v: 2,
          type: data.envelope.type,
          mediaId: data.envelope.mediaId,
          storageKey: data.envelope.storageKey,
          mime: data.envelope.mime,
          iv: data.envelope.iv,
          fileSize: data.envelope.fileSize,
        };
        content = JSON.stringify(validEnvelope);
        isE2EE = true;
      } else if (isValidE2EEMediaV1Envelope(data.envelope)) {
        validEnvelope = {
          e2ee: true,
          v: 1,
          type: data.envelope.type,
          mime: data.envelope.mime,
          iv: data.envelope.iv,
          ct: data.envelope.ct,
        };
        // Store opaque serialized media envelope directly
        content = JSON.stringify(validEnvelope);
        isE2EE = true;
      } else if (isValidE2EEEnvelope(data.envelope)) {
        validEnvelope = {
          e2ee: true,
          v: 1,
          iv: data.envelope.iv,
          ct: data.envelope.ct,
        };
        // Store opaque serialized text envelope directly
        content = JSON.stringify(validEnvelope);
        isE2EE = true;
      } else {
        socket.emit('friend_message_error', {
          message: 'Invalid E2EE message envelope',
        });
        return;
      }
    } else if (data?.text?.trim()) {
      // Legacy plaintext path during transition
      content = data.text.trim();
    } else {
      return;
    }

    const message = await this.prisma.message.create({
      data: {
        content,
        chatId,
        senderId: authenticatedSenderId,
        replyToId: replyToId || null,
        status: 'sent',
      },
      include: { replyTo: true },
    });

    // If v2 media attachment, link messageId to mediaAttachment
    if (validEnvelope && 'v' in validEnvelope && validEnvelope.v === 2 && 'mediaId' in validEnvelope) {
      await this.prisma.mediaAttachment.update({
        where: { id: validEnvelope.mediaId },
        data: { messageId: message.id },
      });
    }

    // Determine replyTo structure without creating server-side plaintext reply previews for E2EE
    let replyToPayload: { id: string; content?: string; text?: string; type?: string } | null = null;
    if (message.replyTo) {
      const isReplyAudio = message.replyTo.content.startsWith('audio:');
      const isReplyImage = message.replyTo.content.startsWith('image:');
      const replyMediaEnv = parseE2EEMediaEnvelope(message.replyTo.content);
      const replyTextEnv = !replyMediaEnv ? parseE2EEEnvelope(message.replyTo.content) : null;

      if (replyMediaEnv) {
        replyToPayload = {
          id: message.replyTo.id,
          content: message.replyTo.content, // Opaque encrypted envelope string
          text: replyMediaEnv.type === 'image' ? 'Encrypted image' : 'Encrypted audio',
          type: replyMediaEnv.type,
        };
      } else if (replyTextEnv) {
        replyToPayload = {
          id: message.replyTo.id,
          content: message.replyTo.content, // Opaque encrypted envelope string
          type: 'text',
        };
      } else {
        replyToPayload = {
          id: message.replyTo.id,
          text: message.replyTo.content,
          type: isReplyAudio ? 'audio' : isReplyImage ? 'image' : 'text',
        };
      }
    }

    if (isE2EE && validEnvelope) {
      const isMedia = 'type' in validEnvelope && (validEnvelope.type === 'image' || validEnvelope.type === 'audio');
      const messageType = isMedia ? (validEnvelope as BackendE2EEMediaEnvelope).type : 'text';

      // E2EE path: Emit envelope, DO NOT include plaintext text
      this.server.to(roomId).emit('receive_friend_message', {
        id: message.id,
        clientId: data.clientId,
        envelope: validEnvelope,
        senderId: authenticatedSenderId,
        timestamp: message.createdAt.getTime(),
        type: messageType,
        status: 'sent',
        replyTo: replyToPayload,
      });
    } else {
      // Legacy plaintext path
      this.server.to(roomId).emit('receive_friend_message', {
        id: message.id,
        clientId: data.clientId,
        text: message.content,
        senderId: authenticatedSenderId,
        timestamp: message.createdAt.getTime(),
        type: 'text',
        status: 'sent',
        replyTo: replyToPayload,
      });
    }

    // Explicit ACK for sender optimistic message reconciliation
    if (data.clientId) {
      socket.emit('friend_message_sent', {
        id: message.id,
        clientId: data.clientId,
        status: 'sent',
      });
    }

    // Create in-app notification for the friend
    try {
      const chat = await this.prisma.chat.findUnique({
        where: { id: chatId },
        select: { userAId: true, userBId: true },
      });
      if (chat) {
        const receiverId = chat.userAId === authenticatedSenderId ? chat.userBId : chat.userAId;
        const senderUser = await this.prisma.user.findUnique({
          where: { id: authenticatedSenderId },
          select: { username: true },
        });
        const senderName = senderUser?.username || 'A friend';

        // CRITICAL: For E2EE messages, notification body MUST be generic. NEVER extract or preview ciphertext!
        let notificationBody = 'New encrypted message';
        if (isE2EE && validEnvelope && 'type' in validEnvelope) {
          notificationBody = validEnvelope.type === 'image' ? 'New encrypted photo' : 'New encrypted voice message';
        } else if (!isE2EE) {
          notificationBody = data.text && data.text.length > 60 ? `${data.text.substring(0, 60)}...` : data.text || 'New message';
        }

        await this.notifications.createNotification({
          userId: receiverId,
          type: 'NEW_MESSAGE',
          title: `New message from ${senderName}`,
          body: notificationBody,
          data: { friendId: authenticatedSenderId, chatId, roomId },
        });
      }
    } catch (e) {
      console.warn('Could not create message notification:', e);
    }
  }

  @SubscribeMessage('send_friend_voice_message')
  async sendFriendVoiceMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: FriendVoiceMessageData,
  ) {
    const { roomId, audioData, replyToId } = data;
    if (!roomId || !audioData || !this.validateAudioPayload(audioData)) {
      if (data?.clientId) {
        socket.emit('friend_voice_error', {
          clientId: data.clientId,
          message: "Voice note couldn't be sent. Please try again.",
        });
      }
      return;
    }

    let senderId = data.senderId;
    let { userId: contextUserId, chatId } = await this.getSocketContext(socket);
    if (!senderId) {
      senderId = contextUserId || (await this.getUserId(socket)) || undefined;
    }
    if (!chatId && roomId.startsWith('friend-') && senderId) {
      const rest = roomId.slice('friend-'.length);
      let targetUserId: string | null = null;
      if (rest.startsWith(senderId + '-')) {
        targetUserId = rest.slice(senderId.length + 1);
      } else if (rest.endsWith('-' + senderId)) {
        targetUserId = rest.slice(0, rest.length - senderId.length - 1);
      }

      if (targetUserId) {
        const chat = await this.prisma.chat.findFirst({
          where: {
            OR: [
              { userAId: senderId, userBId: targetUserId },
              { userAId: targetUserId, userBId: senderId },
            ],
          },
        });
        if (chat) chatId = chat.id;
      }
    }
    if (!senderId || !chatId) {
      if (data?.clientId) {
        socket.emit('friend_voice_error', {
          clientId: data.clientId,
          message: "Voice note couldn't be sent. Please try again.",
        });
      }
      return;
    }

    const content = `audio:${audioData}`;
    const message = await this.prisma.message.create({
      data: { content, chatId, senderId, replyToId: replyToId || null, status: 'sent' },
      include: {
        replyTo: true,
      },
    });

    socket.emit('friend_message_sent', {
      id: message.id,
      clientId: data.clientId,
      timestamp: message.createdAt.getTime(),
      status: 'sent',
    });

    this.server.to(roomId).emit('receive_friend_message', {
      id: message.id,
      clientId: data.clientId,
      text: 'Voice message',
      senderId,
      timestamp: message.createdAt.getTime(),
      type: 'audio',
      audioUrl: audioData,
      status: 'delivered',
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            text: message.replyTo.content,
            type: message.replyTo.content.startsWith('audio:')
              ? 'audio'
              : message.replyTo.content.startsWith('image:')
              ? 'image'
              : 'text',
          }
        : null,
    });
  }

  @SubscribeMessage('send_friend_image_message')
  async sendFriendImageMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: FriendImageMessageData,
  ) {
    const { roomId, imageData, text, replyToId } = data;
    if (!roomId || !imageData || !this.validateImagePayload(imageData)) {
      if (data?.clientId) {
        socket.emit('friend_image_error', {
          clientId: data.clientId,
          message: "Photo couldn't be sent. Please try again.",
        });
      }
      return;
    }

    let { userId: senderId, chatId } = await this.getSocketContext(socket);
    if (!senderId) {
      senderId = (await this.getUserId(socket)) || undefined;
    }
    if (!chatId && roomId.startsWith('friend-') && senderId) {
      const rest = roomId.slice('friend-'.length);
      let targetUserId: string | null = null;
      if (rest.startsWith(senderId + '-')) {
        targetUserId = rest.slice(senderId.length + 1);
      } else if (rest.endsWith('-' + senderId)) {
        targetUserId = rest.slice(0, rest.length - senderId.length - 1);
      }

      if (targetUserId) {
        const chat = await this.prisma.chat.findFirst({
          where: {
            OR: [
              { userAId: senderId, userBId: targetUserId },
              { userAId: targetUserId, userBId: senderId },
            ],
          },
        });
        if (chat) chatId = chat.id;
      }
    }
    if (!senderId || !chatId) return;

    const content = `image:${imageData}`;
    const message = await this.prisma.message.create({
      data: { content, chatId, senderId, replyToId: replyToId || null, status: 'sent' },
    });

    this.server.to(roomId).emit('receive_friend_message', {
      id: message.id,
      text: text || 'Photo message',
      senderId,
      timestamp: message.createdAt.getTime(),
      type: 'image',
      imageUrl: imageData,
    });
  }

  @SubscribeMessage('end_chat')
  async endChatHandler(@ConnectedSocket() socket: Socket) {
    await this.leaveChat(socket, 'ended');
  }

  @SubscribeMessage('next_stranger')
  async nextStrangerHandler(
    @ConnectedSocket() socket: Socket,
    @MessageBody() preferences?: MatchPreferences,
  ) {
    let prefs = preferences;
    if (!prefs || !prefs.interests || prefs.interests.length === 0) {
      const userId = await this.getUserId(socket);
      if (userId) {
        const userProfile = await this.getUserProfile(userId);
        if (userProfile) {
          prefs = {
            language: userProfile.language || 'English',
            interests: userProfile.interests || [],
            goal: userProfile.goal || 'casual-chat',
          };
        }
      }
    }
    await this.skipStranger(socket, prefs);
  }

  // ==========================================
  // WEBRTC VIDEO CALL SIGNALING & SECURITY
  // ==========================================

  private async validateVideoSignalingContext(
    socket: Socket,
    roomId: string,
    callId?: string,
  ): Promise<{
    isValid: boolean;
    isFriend: boolean;
    senderId?: string;
    targetUserId?: string;
    errorReason?: string;
  }> {
    if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
      return { isValid: false, isFriend: false, errorReason: 'Room ID is required.' };
    }

    const senderId = await this.getUserId(socket);
    if (!senderId) {
      return { isValid: false, isFriend: false, errorReason: 'Sender is not authenticated.' };
    }

    // ----------------------------------------------------
    // FRIEND ROOM VALIDATION
    // ----------------------------------------------------
    if (roomId.startsWith('friend-')) {
      const rest = roomId.slice('friend-'.length);
      let targetUserId: string | null = null;

      if (rest.startsWith(senderId + '-')) {
        targetUserId = rest.slice(senderId.length + 1);
      } else if (rest.endsWith('-' + senderId)) {
        targetUserId = rest.slice(0, rest.length - senderId.length - 1);
      }

      if (!targetUserId || !targetUserId.trim()) {
        return { isValid: false, isFriend: true, errorReason: 'Sender does not belong to this private conversation.' };
      }

      // Verify canonical room format
      const canonicalRoomId = `friend-${[senderId, targetUserId].sort().join('-')}`;
      if (roomId !== canonicalRoomId) {
        return { isValid: false, isFriend: true, errorReason: 'Invalid friend room structure.' };
      }

      // 1. Verify recipient user exists in database
      const targetUser = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, username: true },
      });
      if (!targetUser) {
        return { isValid: false, isFriend: true, errorReason: 'User not found or account was deleted.' };
      }

      // 2. Verify friendship in PostgreSQL/Prisma
      const friendship = await this.prisma.friendship.findFirst({
        where: {
          OR: [
            { userAId: senderId, userBId: targetUserId },
            { userAId: targetUserId, userBId: senderId },
          ],
        },
      });
      if (!friendship) {
        return { isValid: false, isFriend: true, errorReason: 'You can only video call accepted Chirp friends.' };
      }

      // 3. Verify neither user is blocked
      const block = await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: senderId, blockedId: targetUserId },
            { blockerId: targetUserId, blockedId: senderId },
          ],
        },
      });
      if (block) {
        return { isValid: false, isFriend: true, errorReason: 'Cannot start video call due to user restrictions.' };
      }

      return {
        isValid: true,
        isFriend: true,
        senderId,
        targetUserId,
      };
    }

    // ----------------------------------------------------
    // STRANGER ROOM VALIDATION
    // ----------------------------------------------------
    const { roomId: currentRoomId } = await this.getSocketContext(socket);
    if (!currentRoomId || currentRoomId !== roomId) {
      return { isValid: false, isFriend: false, errorReason: 'Invalid active chat room or call session.' };
    }

    return {
      isValid: true,
      isFriend: false,
      senderId,
    };
  }

  @SubscribeMessage('video_call_request')
  async handleVideoCallRequest(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId: string },
  ) {
    if (
      !data ||
      typeof data !== 'object' ||
      !data.callId ||
      !data.roomId ||
      typeof data.callId !== 'string' ||
      typeof data.roomId !== 'string' ||
      !data.callId.trim() ||
      !data.roomId.trim()
    ) {
      socket.emit('video_call_error', { message: 'Missing or invalid call identifier and room ID.' });
      return;
    }

    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid) {
      socket.emit('video_call_error', { message: validation.errorReason || 'Invalid active chat room or call session.' });
      return;
    }

    const senderId = validation.senderId!;
    if (validation.isFriend && validation.targetUserId) {
      // 1. Check if caller is already in an active connected video call
      const callerActiveCall = this.getActiveCallForUser(senderId);
      if (callerActiveCall && callerActiveCall.status === 'connected' && callerActiveCall.callId !== data.callId) {
        socket.emit('video_call_error', { message: 'You are already in an active video call.' });
        return;
      }

      // 2. Check if target user is already in an active connected video call
      const targetActiveCall = this.getActiveCallForUser(validation.targetUserId);
      if (targetActiveCall && targetActiveCall.status === 'connected') {
        socket.emit('video_call_declined', {
          roomId: data.roomId,
          callId: data.callId,
          reason: 'busy',
        });
        return;
      }

      // 3. Check if target friend is currently online
      const targetSockets = this.inMemoryUserSockets.get(validation.targetUserId);
      let isTargetOnline = !!(targetSockets && targetSockets.size > 0);
      if (!isTargetOnline) {
        isTargetOnline = await this.redis.isUserOnline(validation.targetUserId);
      }

      if (!isTargetOnline) {
        socket.emit('video_call_error', { message: 'Friend is currently offline.' });
        return;
      }

      // 4. Register active call session
      this.registerActiveCallSession({
        callId: data.callId,
        roomId: data.roomId,
        chatType: 'friend',
        callerId: senderId,
        receiverId: validation.targetUserId,
        status: 'calling',
        updatedAt: Date.now(),
      });

      // Fetch caller info for incoming call modal
      const caller = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { username: true, avatar: true },
      });

      const payload = {
        roomId: data.roomId,
        callId: data.callId,
        callerUserId: senderId,
        callerName: caller?.username || 'Friend',
        callerAvatar: caller?.avatar || '👤',
        chatType: 'friend',
      };

      // SINGLE DELIVERY: Emit only to target user's personal user room
      // This prevents double delivery to friends who are already in data.roomId
      this.server.to(`user:${validation.targetUserId}`).emit('video_call_request', payload);
    } else {
      this.registerActiveCallSession({
        callId: data.callId,
        roomId: data.roomId,
        chatType: 'stranger',
        callerId: senderId,
        status: 'calling',
        updatedAt: Date.now(),
      });

      socket.to(data.roomId).emit('video_call_request', {
        roomId: data.roomId,
        callId: data.callId,
        callerUserId: validation.senderId,
        chatType: 'stranger',
      });
    }
  }

  @SubscribeMessage('video_call_accepted')
  async handleVideoCallAccepted(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId: string },
  ) {
    if (!data?.callId) return;
    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid) return;

    const session = this.inMemoryActiveCallSessions.get(data.callId);
    if (session) {
      session.status = 'connected';
      session.updatedAt = Date.now();
    }

    const payload = {
      roomId: data.roomId,
      callId: data.callId,
      responderUserId: validation.senderId,
    };

    // Both users are in data.roomId, emit cleanly to peer
    socket.to(data.roomId).emit('video_call_accepted', payload);
  }

  @SubscribeMessage('video_call_declined')
  async handleVideoCallDeclined(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId: string; reason?: string },
  ) {
    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid) return;

    this.clearActiveCallSession(data?.callId, data?.roomId);

    const payload = {
      roomId: data.roomId,
      callId: data?.callId,
      reason: data?.reason || 'declined',
    };

    socket.to(data.roomId).emit('video_call_declined', payload);
    if (validation.isFriend && validation.targetUserId) {
      this.server.to(`user:${validation.targetUserId}`).emit('video_call_declined', payload);
    }
  }

  @SubscribeMessage('video_call_cancelled')
  async handleVideoCallCancelled(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId: string },
  ) {
    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid) return;

    this.clearActiveCallSession(data?.callId, data?.roomId);

    const payload = {
      roomId: data.roomId,
      callId: data?.callId,
    };

    socket.to(data.roomId).emit('video_call_cancelled', payload);
    if (validation.isFriend && validation.targetUserId) {
      this.server.to(`user:${validation.targetUserId}`).emit('video_call_cancelled', payload);
    }
  }

  @SubscribeMessage('video_offer')
  async handleVideoOffer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId: string; sdp: any },
  ) {
    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid || !data?.sdp) return;

    const payload = {
      roomId: data.roomId,
      callId: data.callId,
      sdp: data.sdp,
    };

    socket.to(data.roomId).emit('video_offer', payload);
  }

  @SubscribeMessage('video_answer')
  async handleVideoAnswer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId: string; sdp: any },
  ) {
    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid || !data?.sdp) return;

    const payload = {
      roomId: data.roomId,
      callId: data.callId,
      sdp: data.sdp,
    };

    socket.to(data.roomId).emit('video_answer', payload);
  }

  @SubscribeMessage('video_ice_candidate')
  async handleVideoIceCandidate(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId: string; candidate: any },
  ) {
    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid || !data?.candidate) return;

    const payload = {
      roomId: data.roomId,
      callId: data.callId,
      candidate: data.candidate,
    };

    socket.to(data.roomId).emit('video_ice_candidate', payload);
  }

  @SubscribeMessage('video_call_ended')
  async handleVideoCallEnded(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; callId?: string },
  ) {
    const validation = await this.validateVideoSignalingContext(socket, data?.roomId, data?.callId);
    if (!validation.isValid) return;

    this.clearActiveCallSession(data?.callId, data?.roomId);

    const payload = {
      roomId: data.roomId,
      callId: data?.callId,
    };

    socket.to(data.roomId).emit('video_call_ended', payload);
    if (validation.isFriend && validation.targetUserId) {
      this.server.to(`user:${validation.targetUserId}`).emit('video_call_ended', payload);
    }
  }

  @SubscribeMessage('end_chat')
  async handleEndChat(@ConnectedSocket() socket: Socket) {
    await this.leaveChat(socket, 'ended');
  }

  // ==========================================
  // DISCONNECT & LEAVE HELPERS
  // ==========================================

  private async leaveChat(socket: Socket, reason: 'skipped' | 'blocked' | 'ended' = 'ended') {
    const { roomId, chatId } = await this.getSocketContext(socket);
    if (!roomId) return;

    // Immediately stop and clear active video call on leave ONLY if one was actually active
    const activeCall = this.getActiveCallForRoom(roomId);
    if (activeCall) {
      this.clearActiveCallSession(activeCall.callId);
      socket.to(roomId).emit('video_call_ended', {
        roomId,
        callId: activeCall.callId,
        reason,
      });
    }

    // Determine peer socket ID if available
    let peerSocketId: string | null = null;
    if (this.redis.getIsConnected() && typeof this.redis.getMatchState === 'function') {
      const matchState = await this.redis.getMatchState(roomId);
      if (matchState) {
        peerSocketId = matchState.userASocketId === socket.id ? matchState.userBSocketId : matchState.userASocketId;
      }
    }
    if (!peerSocketId) {
      for (const [sId, rId] of Array.from(this.inMemoryUserRooms.entries())) {
        if (rId === roomId && sId !== socket.id) {
          peerSocketId = sId;
          break;
        }
      }
    }

    // Notify stranger of exit reason with roomId identity
    if (reason === 'skipped') {
      socket.to(roomId).emit('stranger_skipped', { roomId });
    } else if (reason === 'blocked') {
      socket.to(roomId).emit('stranger_blocked', { roomId });
    } else {
      socket.to(roomId).emit('stranger_left', { roomId });
    }

    if (chatId) {
      try {
        const chat = await this.prisma.chat.findUnique({
          where: { id: chatId },
          select: { endedAt: true },
        });

        if (chat && !chat.endedAt) {
          await this.prisma.chat.update({
            where: { id: chatId },
            data: { endedAt: new Date() },
          });
        }
      } catch (error: any) {
        if (error?.code === 'P2025') {
          // Chat was already updated or deleted concurrently by another operation; treat as completed
        } else {
          throw error;
        }
      }
    }

    socket.leave(roomId);

    if (this.redis.getIsConnected()) {
      await this.redis.removeMatchState(roomId);
      await this.redis.setPresence(socket.id, 'online');
      await this.redis.setSocketMapping(socket.id, { roomId: undefined, chatId: undefined });
      if (peerSocketId && peerSocketId !== socket.id) {
        await this.redis.setPresence(peerSocketId, 'online');
        await this.redis.setSocketMapping(peerSocketId, { roomId: undefined, chatId: undefined });
      }
    } else {
      this.inMemoryUserRooms.delete(socket.id);
      this.inMemorySocketChats.delete(socket.id);
      if (peerSocketId && peerSocketId !== socket.id) {
        this.inMemoryUserRooms.delete(peerSocketId);
        this.inMemorySocketChats.delete(peerSocketId);
      }
    }

    if (peerSocketId && peerSocketId !== socket.id) {
      const peerSocket = this.server?.sockets?.sockets?.get?.(peerSocketId);
      if (peerSocket) {
        peerSocket.leave(roomId);
      }
    }

    // Clean up authoritative active match locks for both participants
    const currentUserId = (await this.getSocketContext(socket)).userId || (await this.getUserId(socket));
    if (currentUserId) {
      await this.removeUserActiveSession(currentUserId);
    }
    let peerUserId: string | null = null;
    if (peerSocketId) {
      peerUserId = this.inMemorySocketUsers.get(peerSocketId) || null;
      if (!peerUserId && this.redis.getIsConnected()) {
        const peerMapping = await this.redis.getSocketMapping(peerSocketId);
        peerUserId = peerMapping?.userId || null;
      }
    }
    if (peerUserId) {
      await this.removeUserActiveSession(peerUserId);
    }
    if (chatId) {
      // Fallback: look up chat participants to ensure active locks are cleared even if socket mapping already gone
      try {
        const chatParticipants = await this.prisma.chat.findUnique({
          where: { id: chatId },
          select: { userAId: true, userBId: true },
        });
        if (chatParticipants) {
          await Promise.all([
            this.removeUserActiveSession(chatParticipants.userAId),
            this.removeUserActiveSession(chatParticipants.userBId),
          ]);
        }
      } catch {}
    }
  }

  async handleDisconnect(socket: Socket) {
    console.log('User disconnected:', socket.id);

    const userId = await this.getUserId(socket);
    if (userId) {
      const activeCall = this.getActiveCallForUser(userId);
      if (activeCall) {
        this.clearActiveCallSession(activeCall.callId);
        this.server.to(activeCall.roomId).emit('video_call_ended', {
          roomId: activeCall.roomId,
          callId: activeCall.callId,
          reason: 'disconnected',
        });
      }
    }

    const { roomId, chatId } = await this.getSocketContext(socket);
    if (roomId) {
      const roomActiveCall = this.getActiveCallForRoom(roomId);
      if (roomActiveCall) {
        this.clearActiveCallSession(roomActiveCall.callId);
        socket.to(roomId).emit('video_call_ended', {
          roomId,
          callId: roomActiveCall.callId,
          reason: 'disconnected',
        });
      }
    }

    if (this.redis.getIsConnected()) {
      await this.redis.removeWaitingUserBySocketId(socket.id);
      await this.redis.removePresence(socket.id);
      await this.redis.removeSocketMapping(socket.id);
    } else {
      this.inMemoryWaitingUsers = this.inMemoryWaitingUsers.filter(
        (wu) => wu.socket.id !== socket.id,
      );
      this.inMemoryUserPreferences.delete(socket.id);
      this.inMemorySocketChats.delete(socket.id);
      this.inMemoryUserRooms.delete(socket.id);
    }

    await this.recordUserDisconnect(socket);

    // If socket was in an active room, handle disconnect vs page refresh
    if (roomId) {
      const remainingSockets = userId ? (this.inMemoryUserSockets.get(userId)?.size || 0) : 0;
      if (remainingSockets > 0) {
        // User still has another socket/tab open, do NOT end session or notify stranger
        return;
      }

      if (userId) {
        // User has 0 active sockets (e.g. page refresh in-flight, temporary reconnect)
        // Start a 15-second grace timer before genuinely ending stranger session
        this.cancelDisconnectGraceTimer(userId);
        const graceTimer = setTimeout(async () => {
          this.inMemoryDisconnectGraceTimers.delete(userId);
          // Check if user still has no connected sockets
          const currentSockets = this.inMemoryUserSockets.get(userId)?.size || 0;
          if (currentSockets === 0) {
            console.log(`[Grace Timer Expired] User ${userId} did not reconnect within grace period. Ending session in room ${roomId}.`);
            this.server.to(roomId).emit('stranger_offline', { roomId });
            await this.leaveChat(socket, 'ended');
          }
        }, 15000);

        this.inMemoryDisconnectGraceTimers.set(userId, graceTimer);
      } else {
        // Unauthenticated socket or no userId, immediate end
        socket.to(roomId).emit('stranger_offline', { roomId });
        await this.leaveChat(socket, 'ended');
      }
    }
  }

  // ==========================================
  // CONTEXT & HISTORY HELPERS
  // ==========================================

  private async getFormattedMessages(chatId: string, currentUserId: string) {
    const raw = await this.prisma.message.findMany({
      where: { chatId },
      include: {
        replyTo: true,
        reactions: { select: { emoji: true, userId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return raw.map((item) => {
      const isAudio = item.content.startsWith('audio:');
      const isImage = item.content.startsWith('image:');
      const mediaEnvelope = parseE2EEMediaEnvelope(item.content);
      const textEnvelope = !mediaEnvelope ? parseE2EEEnvelope(item.content) : null;
      const anyEnvelope = mediaEnvelope || textEnvelope;

      // Construct safe replyTo reference without plaintext preview for E2EE
      let replyToPayload: {
        id: string;
        content?: string;
        text?: string;
        sender: string;
        type: string;
      } | null = null;

      if (item.replyTo) {
        const isReplyAudio = item.replyTo.content.startsWith('audio:');
        const isReplyImage = item.replyTo.content.startsWith('image:');
        const replyMediaEnvelope = parseE2EEMediaEnvelope(item.replyTo.content);
        const replyTextEnvelope = !replyMediaEnvelope ? parseE2EEEnvelope(item.replyTo.content) : null;

        if (replyMediaEnvelope) {
          replyToPayload = {
            id: item.replyTo.id,
            content: item.replyTo.content,
            text: replyMediaEnvelope.type === 'image' ? 'Encrypted image' : 'Encrypted audio',
            sender: item.replyTo.senderId === currentUserId ? 'me' : 'stranger',
            type: replyMediaEnvelope.type,
          };
        } else if (replyTextEnvelope) {
          replyToPayload = {
            id: item.replyTo.id,
            content: item.replyTo.content,
            sender: item.replyTo.senderId === currentUserId ? 'me' : 'stranger',
            type: 'text',
          };
        } else {
          replyToPayload = {
            id: item.replyTo.id,
            text: item.replyTo.content,
            sender: item.replyTo.senderId === currentUserId ? 'me' : 'stranger',
            type: isReplyAudio ? 'audio' : isReplyImage ? 'image' : 'text',
          };
        }
      }

      // Base message payload
      const calculatedType = mediaEnvelope
        ? mediaEnvelope.type
        : (isImage ? 'image' : isAudio ? 'audio' : 'text');

      const basePayload = {
        id: item.id,
        senderId: item.senderId,
        createdAt: item.createdAt,
        type: calculatedType as 'text' | 'image' | 'audio',
        audioUrl: isAudio ? item.content.replace('audio:', '') : undefined,
        imageUrl: isImage ? item.content.replace('image:', '') : undefined,
        status: item.status,
        deliveredAt: item.deliveredAt ? item.deliveredAt.getTime() : undefined,
        seenAt: item.seenAt ? item.seenAt.getTime() : undefined,
        deletedAt: item.deletedAt ? item.deletedAt.getTime() : undefined,
        replyTo: replyToPayload,
        reactions: item.reactions || [],
      };

      if (anyEnvelope) {
        // E2EE message: return envelope without decrypting or exposing a plaintext 'text' field
        return {
          ...basePayload,
          envelope: anyEnvelope,
        };
      }

      // Legacy plaintext message or media message
      return {
        ...basePayload,
        text: isImage ? 'Photo message' : isAudio ? 'Voice message' : item.content,
      };
    });
  }

  private async getSocketContext(socket: Socket): Promise<{
    userId?: string;
    roomId?: string;
    chatId?: string;
  }> {
    let userId = this.inMemorySocketUsers.get(socket.id);
    let roomId = this.inMemoryUserRooms.get(socket.id);
    let chatId = this.inMemorySocketChats.get(socket.id);

    if (this.redis.getIsConnected()) {
      const mapping = await this.redis.getSocketMapping(socket.id);
      if (mapping) {
        userId = mapping.userId || userId;
        roomId = mapping.roomId || roomId;
        chatId = mapping.chatId || chatId;
      }
    }

    if (!userId) {
      userId = (await this.getUserId(socket)) || undefined;
    }

    return { userId, roomId, chatId };
  }

  private async getUserId(socket: Socket): Promise<string | null> {
    const existingUserId = this.inMemorySocketUsers.get(socket.id);
    if (existingUserId) return existingUserId;

    // Check if client supplied token or userId in handshake auth or query
    const handshakeToken =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.query?.token as string);

    const handshakeUserId =
      (socket.handshake.auth?.userId as string) ||
      (socket.handshake.query?.userId as string);

    if (handshakeToken) {
      const payload = this.sessionTokenService.verifyToken(handshakeToken);
      if (!payload) {
        return null;
      }
      if (handshakeUserId && handshakeUserId !== payload.userId) {
        return null;
      }
      const verifiedUserId = payload.userId;
      this.knownUserIdsCache.add(verifiedUserId);
      this.inMemorySocketUsers.set(socket.id, verifiedUserId);
      if (this.redis.getIsConnected()) {
        await this.redis.setSocketMapping(socket.id, { userId: verifiedUserId });
      }
      return verifiedUserId;
    }

    // Client claimed an explicit userId without providing a valid session token -> Reject spoofed identity!
    if (handshakeUserId) {
      return null;
    }

    if (this.redis.getIsConnected()) {
      const mapping = await this.redis.getSocketMapping(socket.id);
      if (mapping?.userId) {
        this.knownUserIdsCache.add(mapping.userId);
        this.inMemorySocketUsers.set(socket.id, mapping.userId);
        return mapping.userId;
      }
    }

    const user = await this.prisma.user.create({ data: {} });
    this.knownUserIdsCache.add(user.id);
    this.inMemorySocketUsers.set(socket.id, user.id);

    if (this.redis.getIsConnected()) {
      await this.redis.setSocketMapping(socket.id, { userId: user.id });
    }

    return user.id;
  }

  private validateAudioPayload(audioData: string): boolean {
    if (!audioData || typeof audioData !== 'string') return false;
    if (audioData.length > 5 * 1024 * 1024) return false;
    const lower = audioData.toLowerCase();
    if (lower.includes('<script') || lower.includes('data:text/html') || lower.includes('<svg')) {
      return false;
    }
    const audioPrefixRegex = /^data:audio\/(webm|mp4|ogg|wav|mpeg|aac|x-m4a|m4a|wave);base64,[A-Za-z0-9+/=]+$/;
    if (audioPrefixRegex.test(audioData)) return true;
    const plainBase64Regex = /^[A-Za-z0-9+/=]+$/;
    if (plainBase64Regex.test(audioData) && audioData.length >= 32) return true;
    return false;
  }

  private validateImagePayload(imageData: string): boolean {
    if (!imageData || typeof imageData !== 'string') return false;
    if (imageData.length > 5 * 1024 * 1024) return false;
    const lower = imageData.toLowerCase();
    if (lower.includes('<script') || lower.includes('data:text/html') || lower.includes('<svg') || lower.includes('javascript:')) {
      return false;
    }
    const imagePrefixRegex = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
    if (imagePrefixRegex.test(imageData)) return true;
    return false;
  }


  // ==========================================
  // USER PROFILE HELPER
  // ==========================================

  private async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
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
      return user ?? null;
    } catch {
      return null;
    }
  }

}