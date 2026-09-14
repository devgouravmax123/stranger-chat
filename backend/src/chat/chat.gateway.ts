import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma.service.js';

interface MatchPreferences {
  language: string;
  interests: string[];
  goal: string;
}

interface WaitingUser {
  socket: Socket;
  preferences: MatchPreferences;
}

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000',
  },
})
export class ChatGateway {
  @WebSocketServer()
  server!: Server;

  private waitingUsers: WaitingUser[] = [];

  // socket.id -> room ID
  private userRooms = new Map<string, string>();

  // socket.id -> database user ID
  private socketUsers = new Map<string, string>();

  // socket.id -> database chat ID
  private socketChats = new Map<string, string>();

  // socket.id -> matching preferences
  private userPreferences =
    new Map<string, MatchPreferences>();

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // CONNECTION
  // ==========================================

  async handleConnection(socket: Socket) {
    console.log('User connected:', socket.id);

    const userId = await this.getUserId(socket);

    if (userId) {
      socket.emit('user_ready', {
        userId,
      });

      console.log(
        'User ready:',
        userId,
      );
    }
  }

  // ==========================================
  // FIND STRANGER
  // ==========================================

  @SubscribeMessage('find_stranger')
  async findStranger(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    preferences: MatchPreferences,
  ) {
    console.log(
      'User wants a stranger:',
      socket.id,
    );

    console.log(
      'Preferences:',
      preferences,
    );

    const userId =
      await this.getUserId(socket);

    if (!userId) {
      return;
    }

    // Already chatting
    if (this.userRooms.has(socket.id)) {
      return;
    }

    // Clean preferences
    const cleanPreferences: MatchPreferences =
      {
        language:
          preferences?.language ||
          'English',

        interests:
          Array.isArray(
            preferences?.interests,
          )
            ? preferences.interests
            : [],

        goal:
          preferences?.goal ||
          'casual-chat',
      };

    // Save preferences
    this.userPreferences.set(
      socket.id,
      cleanPreferences,
    );

    // Already waiting
    const alreadyWaiting =
      this.waitingUsers.some(
        (waitingUser) =>
          waitingUser.socket.id ===
          socket.id,
      );

    if (alreadyWaiting) {
      return;
    }

    // ==========================================
    // NO ONE WAITING
    // ==========================================

    if (this.waitingUsers.length === 0) {
      this.waitingUsers.push({
        socket,
        preferences:
          cleanPreferences,
      });

      socket.emit('waiting');

      console.log(
        'User added to waiting queue:',
        socket.id,
      );

      console.log(
        'Waiting preferences:',
        cleanPreferences,
      );

      return;
    }

    // ==========================================
    // MATCH USERS
    // ==========================================

    const waitingUser =
      this.waitingUsers.shift();

    if (!waitingUser) {
      return;
    }

    const stranger =
      waitingUser.socket;

    const strangerPreferences =
      waitingUser.preferences;

    const strangerUserId =
      this.socketUsers.get(
        stranger.id,
      );

    if (!strangerUserId) {
      console.log(
        'Stranger database user ID not found',
      );

      return;
    }

    // ==========================================
    // MATCH SCORE
    // ==========================================

    const score =
      this.calculateMatchScore(
        cleanPreferences,
        strangerPreferences,
      );

    console.log(
      '=================================',
    );

    console.log(
      'MATCH FOUND',
    );

    console.log(
      'User 1:',
      socket.id,
    );

    console.log(
      'User 1 database ID:',
      userId,
    );

    console.log(
      'User 2:',
      stranger.id,
    );

    console.log(
      'User 2 database ID:',
      strangerUserId,
    );

    console.log(
      'Compatibility score:',
      score + '%',
    );

    console.log(
      '=================================',
    );

    // ==========================================
    // CREATE ROOM
    // ==========================================

    const roomId =
      `${stranger.id}-${socket.id}`;

    stranger.join(roomId);
    socket.join(roomId);

    this.userRooms.set(
      stranger.id,
      roomId,
    );

    this.userRooms.set(
      socket.id,
      roomId,
    );

    // ==========================================
    // CREATE DATABASE CHAT
    // ==========================================

    const chat =
      await this.prisma.chat.create({
        data: {
          userAId:
            strangerUserId,

          userBId:
            userId,
        },
      });

    this.socketChats.set(
      stranger.id,
      chat.id,
    );

    this.socketChats.set(
      socket.id,
      chat.id,
    );

    console.log(
      'Database Chat ID:',
      chat.id,
    );

    // ==========================================
    // CHAT HISTORY
    // ==========================================

    const messages =
      await this.prisma.message.findMany(
        {
          where: {
            chatId: chat.id,
          },

          orderBy: {
            createdAt: 'asc',
          },
        },
      );

    console.log(
      'Chat history:',
      messages.length,
      'messages',
    );

    // ==========================================
    // SEND CHAT HISTORY
    // ==========================================

    stranger.emit(
      'chat_history',
      {
        messages,
        userId:
          strangerUserId,
      },
    );

    socket.emit(
      'chat_history',
      {
        messages,
        userId,
      },
    );

    // ==========================================
    // MATCHED
    // ==========================================

    // IMPORTANT:
    //
    // Each user receives:
    //
    // userId         = THEIR database ID
    // strangerUserId = OTHER user's database ID
    //
    // This allows the frontend to send
    // a friend request to the stranger.

    stranger.emit('matched', {
  roomId,
  userId: strangerUserId,
  strangerUserId: userId,
  score,
});

socket.emit('matched', {
  roomId,
  userId,
  strangerUserId,
  score,
});
  }

  // ==========================================
  // MATCH SCORE
  // ==========================================

  private calculateMatchScore(
    user1: MatchPreferences,
    user2: MatchPreferences,
  ): number {
    let score = 0;

    // LANGUAGE
    if (
      user1.language.toLowerCase() ===
      user2.language.toLowerCase()
    ) {
      score += 40;
    }

    // INTERESTS

    const interests1 =
      new Set(
        user1.interests.map(
          (interest) =>
            interest.toLowerCase(),
        ),
      );

    const interests2 =
      new Set(
        user2.interests.map(
          (interest) =>
            interest.toLowerCase(),
        ),
      );

    const commonInterests =
      [...interests1].filter(
        (interest) =>
          interests2.has(interest),
      );

    const allInterests =
      new Set([
        ...interests1,
        ...interests2,
      ]);

    if (allInterests.size > 0) {
      const interestRatio =
        commonInterests.length /
        allInterests.size;

      score +=
        interestRatio * 40;
    }

    // GOAL

    if (
      user1.goal.toLowerCase() ===
      user2.goal.toLowerCase()
    ) {
      score += 20;
    }

    return Math.round(score);
  }

  // ==========================================
  // SEND MESSAGE
  // ==========================================

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() socket: Socket,

    @MessageBody()
    data: { text: string },
  ) {
    const roomId =
      this.userRooms.get(
        socket.id,
      );

    const userId =
      this.socketUsers.get(
        socket.id,
      );

    const chatId =
      this.socketChats.get(
        socket.id,
      );

    if (
      !roomId ||
      !userId ||
      !chatId
    ) {
      return;
    }

    if (
      !data?.text?.trim()
    ) {
      return;
    }

    const text =
      data.text.trim();

    const message =
      await this.prisma.message.create(
        {
          data: {
            content: text,

            chatId,

            senderId: userId,
          },
        },
      );

    console.log(
      'Message saved:',
      message.id,
    );

    this.server
      .to(roomId)
      .emit(
        'receive_message',
        {
          text:
            message.content,

          sender:
            socket.id,

          timestamp:
            message.createdAt.getTime(),
        },
      );
  }

  // ==========================================
  // TYPING
  // ==========================================

  @SubscribeMessage('typing')
  typing(
    @ConnectedSocket()
    socket: Socket,
  ) {
    const roomId =
      this.userRooms.get(
        socket.id,
      );

    if (!roomId) {
      return;
    }

    socket
      .to(roomId)
      .emit(
        'stranger_typing',
      );
  }

  // ==========================================
  // STOP TYPING
  // ==========================================

  @SubscribeMessage('stop_typing')
  stopTyping(
    @ConnectedSocket()
    socket: Socket,
  ) {
    const roomId =
      this.userRooms.get(
        socket.id,
      );

    if (!roomId) {
      return;
    }

    socket
      .to(roomId)
      .emit(
        'stranger_stopped_typing',
      );
  }

  // ==========================================
  // END CHAT
  // ==========================================

  @SubscribeMessage('end_chat')
  async endChat(
    @ConnectedSocket()
    socket: Socket,
  ) {
    await this.leaveChat(socket);
  }

  // ==========================================
  // NEXT STRANGER
  // ==========================================

  @SubscribeMessage('next_stranger')
  async nextStranger(
    @ConnectedSocket()
    socket: Socket,
  ) {
    console.log(
      'User wants next stranger:',
      socket.id,
    );

    await this.leaveChat(socket);

    const preferences =
      this.userPreferences.get(
        socket.id,
      ) ?? {
        language: 'English',
        interests: [],
        goal: 'casual-chat',
      };

    await this.findStranger(
      socket,
      preferences,
    );
  }

  // ==========================================
  // LEAVE CHAT
  // ==========================================

  private async leaveChat(
    socket: Socket,
  ) {
    const roomId =
      this.userRooms.get(
        socket.id,
      );

    const chatId =
      this.socketChats.get(
        socket.id,
      );

    if (!roomId) {
      return;
    }

    // Tell stranger
    socket
      .to(roomId)
      .emit(
        'stranger_left',
      );

    // ==========================================
    // END DATABASE CHAT
    // ==========================================

    if (chatId) {
      const chat =
        await this.prisma.chat.findUnique(
          {
            where: {
              id: chatId,
            },

            select: {
              endedAt: true,
            },
          },
        );

      if (
        chat &&
        !chat.endedAt
      ) {
        await this.prisma.chat.update(
          {
            where: {
              id: chatId,
            },

            data: {
              endedAt:
                new Date(),
            },
          },
        );

        console.log(
          'Chat ended:',
          chatId,
        );
      }
    }

    socket.leave(roomId);

    this.userRooms.delete(
      socket.id,
    );

    this.socketChats.delete(
      socket.id,
    );
  }

  // ==========================================
  // DISCONNECT
  // ==========================================

  async handleDisconnect(
    socket: Socket,
  ) {
    console.log(
      'User disconnected:',
      socket.id,
    );

    // Remove from waiting queue
    this.waitingUsers =
      this.waitingUsers.filter(
        (waitingUser) =>
          waitingUser.socket.id !==
          socket.id,
      );

    await this.leaveChat(
      socket,
    );

    this.socketUsers.delete(
      socket.id,
    );

    this.userPreferences.delete(
      socket.id,
    );
  }

  // ==========================================
  // CREATE DATABASE USER
  // ==========================================

  private async getUserId(
    socket: Socket,
  ): Promise<string | null> {
    const existingUserId =
      this.socketUsers.get(
        socket.id,
      );

    if (existingUserId) {
      return existingUserId;
    }

    const user =
      await this.prisma.user.create(
        {
          data: {},
        },
      );

    this.socketUsers.set(
      socket.id,
      user.id,
    );

    console.log(
      'Database user created:',
      user.id,
    );

    return user.id;
  }
}