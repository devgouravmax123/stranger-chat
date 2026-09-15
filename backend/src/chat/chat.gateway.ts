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

interface MatchPreferences {
  language: string;
  interests: string[];
  goal: string;
}

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
}

interface SendMessageDto {
  text: string;
  clientId?: string;
  replyToId?: string;
}

interface VoiceMessageData {
  audioData: string;
  clientId?: string;
  replyToId?: string;
}

interface FriendVoiceMessageData {
  roomId: string;
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
  imageData: string;
  text?: string;
  replyToId?: string;
}

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000',
  },
})
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  // In-memory fallback structures when Redis is offline
  private inMemoryWaitingUsers: WaitingUser[] = [];
  private inMemoryUserRooms = new Map<string, string>();
  private inMemorySocketUsers = new Map<string, string>();
  private inMemorySocketChats = new Map<string, string>();
  private inMemoryUserPreferences = new Map<string, MatchPreferences>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  afterInit(server: Server) {
    this.notifications.registerNotificationEmitter((userId: string, notification: any) => {
      // Find all connected sockets belonging to this userId
      for (const [sockId, uid] of this.inMemorySocketUsers.entries()) {
        if (uid === userId) {
          this.server.to(sockId).emit('new_notification', notification);
        }
      }
    });
  }

  // ==========================================
  // CONNECTION
  // ==========================================

  async handleConnection(socket: Socket) {
    console.log('User connected:', socket.id);

    const userId = await this.getUserId(socket);

    if (userId) {
      this.inMemorySocketUsers.set(socket.id, userId);
      if (this.redis.getIsConnected()) {
        await this.redis.setPresence(socket.id, 'online');
        await this.redis.setSocketMapping(socket.id, { userId });
      }

      socket.emit('user_ready', { userId });
      console.log('User ready:', userId);
    }
  }

  @SubscribeMessage('friend_online')
  async handleFriendOnline(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { userId: string },
  ) {
    if (!data?.userId) return;
    this.inMemorySocketUsers.set(socket.id, data.userId);
    if (this.redis.getIsConnected()) {
      await this.redis.setPresence(socket.id, 'online');
      await this.redis.setSocketMapping(socket.id, { userId: data.userId });
    }
  }

  @SubscribeMessage('leave_friend_room')
  async handleLeaveFriendRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!data?.roomId) return;
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

    const cleanPreferences: MatchPreferences = {
      language: preferences?.language || 'English',
      interests: Array.isArray(preferences?.interests) ? preferences.interests : [],
      goal: preferences?.goal || 'casual-chat',
    };

    // Get list of blocked user IDs for current user
    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blockedUserIds = new Set<string>();
    blocks.forEach((b) => {
      blockedUserIds.add(b.blockerId);
      blockedUserIds.add(b.blockedId);
    });

    // Clean up any stale active chat before initiating new matchmaking
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

        // Blocked user check
        if (blockedUserIds.has(candidate.userId)) {
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
        return;
      }

      const strangerSocket = this.server.sockets.sockets.get(waitingCandidate.socketId)!;
      const strangerUserId = waitingCandidate.userId;
      const strangerPreferences = waitingCandidate.preferences;

      const score = this.calculateMatchScore(cleanPreferences, strangerPreferences);
      const roomId = `${strangerSocket.id}-${socket.id}`;

      strangerSocket.join(roomId);
      socket.join(roomId);

      const chat = await this.prisma.chat.create({
        data: {
          userAId: strangerUserId,
          userBId: userId,
        },
      });

      await this.redis.setMatchState(roomId, {
        userAId: strangerUserId,
        userASocketId: strangerSocket.id,
        userBId: userId,
        userBSocketId: socket.id,
        chatId: chat.id,
        createdAt: Date.now(),
      });

      await this.redis.setSocketMapping(strangerSocket.id, {
        userId: strangerUserId,
        roomId,
        chatId: chat.id,
      });

      await this.redis.setSocketMapping(socket.id, {
        userId,
        roomId,
        chatId: chat.id,
      });

      await this.redis.setPresence(strangerSocket.id, 'chatting');
      await this.redis.setPresence(socket.id, 'chatting');

      const messages = await this.getFormattedMessages(chat.id, userId);
      const strangerMessages = await this.getFormattedMessages(chat.id, strangerUserId);

      strangerSocket.emit('chat_history', { messages: strangerMessages, userId: strangerUserId });
      socket.emit('chat_history', { messages, userId });

      const strangerProfile = await this.getUserProfile(strangerUserId);
      const userProfile = await this.getUserProfile(userId);

      console.log(`[Matchmaking] Matched users via Redis: ${userId} & ${strangerUserId} in room ${roomId}`);

      strangerSocket.emit('matched', {
        roomId,
        userId: strangerUserId,
        strangerUserId: userId,
        score,
        strangerProfile: userProfile,
      });

      socket.emit('matched', {
        roomId,
        userId,
        strangerUserId,
        score,
        strangerProfile,
      });

      // Emit connection status to both
      this.server.to(roomId).emit('stranger_online');
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
        !blockedUserIds.has(candidateUserId)
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

    const score = this.calculateMatchScore(cleanPreferences, waitingUser.preferences);
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

    const messages = await this.getFormattedMessages(chat.id, userId);
    const strangerMessages = await this.getFormattedMessages(chat.id, strangerUserId);

    stranger.emit('chat_history', { messages: strangerMessages, userId: strangerUserId });
    socket.emit('chat_history', { messages, userId });

    const strangerProfile = await this.getUserProfile(strangerUserId);
    const userProfile = await this.getUserProfile(userId);

    stranger.emit('matched', {
      roomId,
      userId: strangerUserId,
      strangerUserId: userId,
      score,
      strangerProfile: userProfile,
    });

    socket.emit('matched', {
      roomId,
      userId,
      strangerUserId,
      score,
      strangerProfile,
    });

    this.server.to(roomId).emit('stranger_online');
  }

  // ==========================================
  // FEATURE 1 — SKIP / NEXT STRANGER
  // ==========================================

  @SubscribeMessage('skip_stranger')
  async skipStranger(
    @ConnectedSocket() socket: Socket,
    @MessageBody() preferences: MatchPreferences,
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

    // Immediately trigger matchmaking for next stranger
    const cleanPref = preferences || {
      language: 'English',
      interests: [],
      goal: 'casual-chat',
    };
    await this.findStranger(socket, cleanPref);
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
    if (!roomId || !userId || !chatId || !data?.text?.trim()) return;

    const text = data.text.trim();
    const replyToId = data.replyToId || null;

    const message = await this.prisma.message.create({
      data: {
        content: text,
        chatId,
        senderId: userId,
        replyToId,
        status: 'sent',
      },
      include: {
        replyTo: true,
        reactions: true,
      },
    });

    // Send ACK to sender
    socket.emit('message_sent', {
      id: message.id,
      clientId: data.clientId,
      timestamp: message.createdAt.getTime(),
      status: 'sent',
    });

    // Broadcast to stranger in room
    socket.to(roomId).emit('receive_message', {
      id: message.id,
      clientId: data.clientId,
      text: message.content,
      senderId: userId,
      timestamp: message.createdAt.getTime(),
      type: 'text',
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

    // Mark as delivered in DB
    await this.prisma.message.update({
      where: { id: message.id },
      data: { status: 'delivered', deliveredAt: new Date() },
    });

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
      return;
    }

    const { roomId, userId, chatId } = await this.getSocketContext(socket);
    if (!roomId || !userId || !chatId || !data?.audioData) return;

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
    if (!roomId || !userId || !chatId || !data?.imageData) return;

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

    if (!roomId && chatId) {
      const chat = await this.prisma.chat.findUnique({
        where: { id: chatId },
        include: { friendship: true },
      });
      if (chat) {
        roomId = chat.friendship
          ? `friend-${[chat.userAId, chat.userBId].sort().join('-')}`
          : chat.id;
      }
    }

    if (!roomId || !chatId || !userId) return;

    // Update messages in DB
    const updateResult = await this.prisma.message.updateMany({
      where: {
        chatId,
        senderId: { not: userId },
        status: { not: 'seen' },
      },
      data: {
        status: 'seen',
        seenAt: new Date(),
      },
    });

    // Notify stranger / friend room that messages were seen
    this.server.to(roomId).emit('message_seen', {
      chatId,
      messageIds: data?.messageIds || [],
      count: updateResult.count,
    });
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
    @MessageBody() data: { roomId: string; senderId: string; text: string; replyToId?: string },
  ) {
    const { roomId, senderId, text, replyToId } = data;
    if (!roomId || !senderId || !text?.trim()) return;

    let { chatId } = await this.getSocketContext(socket);
    if (!chatId && roomId.startsWith('friend-')) {
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
    if (!chatId) return;

    const message = await this.prisma.message.create({
      data: {
        content: text.trim(),
        chatId,
        senderId,
        replyToId: replyToId || null,
        status: 'sent',
      },
      include: { replyTo: true },
    });

    this.server.to(roomId).emit('receive_friend_message', {
      id: message.id,
      text: message.content,
      senderId,
      timestamp: message.createdAt.getTime(),
      type: 'text',
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

    // Create in-app notification for the friend
    try {
      const chat = await this.prisma.chat.findUnique({
        where: { id: chatId },
        select: { userAId: true, userBId: true },
      });
      if (chat) {
        const receiverId = chat.userAId === senderId ? chat.userBId : chat.userAId;
        const senderUser = await this.prisma.user.findUnique({
          where: { id: senderId },
          select: { username: true },
        });
        const senderName = senderUser?.username || 'A friend';
        await this.notifications.createNotification({
          userId: receiverId,
          type: 'NEW_MESSAGE',
          title: `New message from ${senderName}`,
          body: text.length > 60 ? `${text.substring(0, 60)}...` : text,
          data: { friendId: senderId, chatId, roomId },
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
    if (!roomId || !audioData) return;

    let { userId: senderId, chatId } = await this.getSocketContext(socket);
    if (!senderId) {
      senderId = (await this.getUserId(socket)) || undefined;
    }
    if (!chatId && roomId.startsWith('friend-')) {
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
    if (!senderId || !chatId) return;

    const content = `audio:${audioData}`;
    const message = await this.prisma.message.create({
      data: { content, chatId, senderId, replyToId: replyToId || null, status: 'sent' },
    });

    this.server.to(roomId).emit('receive_friend_message', {
      id: message.id,
      text: 'Voice message',
      senderId,
      timestamp: message.createdAt.getTime(),
      type: 'audio',
      audioUrl: audioData,
    });
  }

  @SubscribeMessage('send_friend_image_message')
  async sendFriendImageMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: FriendImageMessageData,
  ) {
    const { roomId, imageData, text, replyToId } = data;
    if (!roomId || !imageData) return;

    let { userId: senderId, chatId } = await this.getSocketContext(socket);
    if (!senderId) {
      senderId = (await this.getUserId(socket)) || undefined;
    }
    if (!chatId && roomId.startsWith('friend-')) {
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

  @SubscribeMessage('leave_friend_room')
  leaveFriendRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    if (data?.roomId) socket.leave(data.roomId);
  }

  @SubscribeMessage('end_chat')
  async endChatHandler(@ConnectedSocket() socket: Socket) {
    await this.leaveChat(socket, 'ended');
  }

  @SubscribeMessage('next_stranger')
  async nextStrangerHandler(@ConnectedSocket() socket: Socket) {
    await this.skipStranger(socket, {
      language: 'English',
      interests: [],
      goal: 'casual-chat',
    });
  }

  // ==========================================
  // DISCONNECT & LEAVE HELPERS
  // ==========================================

  private async leaveChat(socket: Socket, reason: 'skipped' | 'blocked' | 'ended' = 'ended') {
    const { roomId, chatId } = await this.getSocketContext(socket);
    if (!roomId) return;

    // Notify stranger of exit reason
    if (reason === 'skipped') {
      socket.to(roomId).emit('stranger_skipped');
    } else if (reason === 'blocked') {
      socket.to(roomId).emit('stranger_blocked');
    } else {
      socket.to(roomId).emit('stranger_left');
    }

    if (chatId) {
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
    }

    socket.leave(roomId);

    if (this.redis.getIsConnected()) {
      await this.redis.removeMatchState(roomId);
      await this.redis.setPresence(socket.id, 'online');
      await this.redis.setSocketMapping(socket.id, { roomId: undefined, chatId: undefined });
    } else {
      this.inMemoryUserRooms.delete(socket.id);
      this.inMemorySocketChats.delete(socket.id);
    }
  }

  async handleDisconnect(socket: Socket) {
    console.log('User disconnected:', socket.id);

    const { roomId } = await this.getSocketContext(socket);
    if (roomId) {
      socket.to(roomId).emit('stranger_offline');
    }

    if (this.redis.getIsConnected()) {
      await this.redis.removeWaitingUserBySocketId(socket.id);
      await this.leaveChat(socket, 'ended');
      await this.redis.removePresence(socket.id);
      await this.redis.removeSocketMapping(socket.id);
    } else {
      this.inMemoryWaitingUsers = this.inMemoryWaitingUsers.filter(
        (wu) => wu.socket.id !== socket.id,
      );
      await this.leaveChat(socket, 'ended');
      this.inMemorySocketUsers.delete(socket.id);
      this.inMemoryUserPreferences.delete(socket.id);
      this.inMemorySocketChats.delete(socket.id);
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

      return {
        id: item.id,
        text: isImage ? 'Photo message' : isAudio ? 'Voice message' : item.content,
        senderId: item.senderId,
        createdAt: item.createdAt,
        type: isImage ? 'image' : isAudio ? 'audio' : 'text',
        audioUrl: isAudio ? item.content.replace('audio:', '') : undefined,
        imageUrl: isImage ? item.content.replace('image:', '') : undefined,
        status: item.status,
        deliveredAt: item.deliveredAt ? item.deliveredAt.getTime() : undefined,
        seenAt: item.seenAt ? item.seenAt.getTime() : undefined,
        deletedAt: item.deletedAt ? item.deletedAt.getTime() : undefined,
        replyTo: item.replyTo
          ? {
              id: item.replyTo.id,
              text: item.replyTo.content,
              sender: item.replyTo.senderId === currentUserId ? 'me' : 'stranger',
              type: item.replyTo.content.startsWith('audio:')
                ? 'audio'
                : item.replyTo.content.startsWith('image:')
                ? 'image'
                : 'text',
            }
          : null,
        reactions: item.reactions || [],
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
      userId = (socket.handshake.auth?.userId as string) || (socket.handshake.query?.userId as string);
    }

    return { userId, roomId, chatId };
  }

  private async getUserId(socket: Socket): Promise<string | null> {
    const existingUserId = this.inMemorySocketUsers.get(socket.id);
    if (existingUserId) return existingUserId;

    // Check if client supplied an existing userId in handshake auth or query
    const handshakeUserId =
      (socket.handshake.auth?.userId as string) ||
      (socket.handshake.query?.userId as string);

    if (handshakeUserId) {
      // Verify user exists in database
      const existingUser = await this.prisma.user.findUnique({
        where: { id: handshakeUserId },
      });
      if (existingUser) {
        this.inMemorySocketUsers.set(socket.id, existingUser.id);
        if (this.redis.getIsConnected()) {
          await this.redis.setSocketMapping(socket.id, { userId: existingUser.id });
        }
        return existingUser.id;
      }
    }

    if (this.redis.getIsConnected()) {
      const mapping = await this.redis.getSocketMapping(socket.id);
      if (mapping?.userId) {
        this.inMemorySocketUsers.set(socket.id, mapping.userId);
        return mapping.userId;
      }
    }

    const user = await this.prisma.user.create({ data: {} });
    this.inMemorySocketUsers.set(socket.id, user.id);

    if (this.redis.getIsConnected()) {
      await this.redis.setSocketMapping(socket.id, { userId: user.id });
    }

    return user.id;
  }

  // ==========================================
  // MATCH SCORE HELPER
  // ==========================================

  private calculateMatchScore(
    prefsA: MatchPreferences,
    prefsB: MatchPreferences,
  ): number {
    let score = 0;

    // Language match: 40 points
    if (prefsA.language === prefsB.language) {
      score += 40;
    }

    // Goal match: 30 points
    if (prefsA.goal === prefsB.goal) {
      score += 30;
    }

    // Shared interests: up to 30 points
    const interestsA = new Set(prefsA.interests || []);
    const interestsB = new Set(prefsB.interests || []);
    const sharedCount = [...interestsA].filter((i) => interestsB.has(i)).length;
    const maxInterests = Math.max(interestsA.size, interestsB.size, 1);
    score += Math.round((sharedCount / maxInterests) * 30);

    return Math.min(score, 100);
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
        },
      });
      return user ?? null;
    } catch {
      return null;
    }
  }

}