import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma.service.js';

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000',
  },
})
export class ChatGateway {
  @WebSocketServer()
  server!: Server;

  private waitingUsers: Socket[] = [];

  // socket.id -> Socket.IO room ID
  private userRooms = new Map<string, string>();

  // socket.id -> Database User ID
  private socketUsers = new Map<string, string>();

  // socket.id -> Database Chat ID
  private socketChats = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // FIND STRANGER
  // ==========================================

  @SubscribeMessage('find_stranger')
  async findStranger(@ConnectedSocket() socket: Socket) {
    console.log('User wants a stranger:', socket.id);

    const userId = await this.getUserId(socket);

    if (!userId) {
      return;
    }

    // Already chatting
    if (this.userRooms.has(socket.id)) {
      return;
    }

    // Already waiting
    const alreadyWaiting = this.waitingUsers.some(
      (user) => user.id === socket.id,
    );

    if (alreadyWaiting) {
      return;
    }

    // ==========================================
    // NO ONE IS WAITING
    // ==========================================

    if (this.waitingUsers.length === 0) {
      this.waitingUsers.push(socket);

      socket.emit('waiting');

      console.log('User added to waiting queue:', socket.id);

      return;
    }

    // ==========================================
    // MATCH USERS
    // ==========================================

    const stranger = this.waitingUsers.shift();

    if (!stranger) {
      return;
    }

    const strangerUserId = this.socketUsers.get(stranger.id);

    if (!strangerUserId) {
      console.log('Stranger database user ID not found');
      return;
    }

    // ==========================================
    // CREATE SOCKET.IO ROOM
    // ==========================================

    const roomId = `${stranger.id}-${socket.id}`;

    stranger.join(roomId);
    socket.join(roomId);

    this.userRooms.set(stranger.id, roomId);
    this.userRooms.set(socket.id, roomId);

    // ==========================================
    // CREATE DATABASE CHAT
    // ==========================================

    const chat = await this.prisma.chat.create({
      data: {
        userAId: strangerUserId,
        userBId: userId,
      },
    });

    this.socketChats.set(stranger.id, chat.id);
    this.socketChats.set(socket.id, chat.id);

    console.log('Match found!');
    console.log('Socket Room:', roomId);
    console.log('Database Chat ID:', chat.id);

    // ==========================================
    // GET CHAT HISTORY
    // ==========================================

    const messages = await this.prisma.message.findMany({
      where: {
        chatId: chat.id,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    console.log('Chat history:', messages.length, 'messages');

    this.server.to(roomId).emit('chat_history', {
      messages,
      userId,
    });

    // ==========================================
    // MATCHED
    // ==========================================

    this.server.to(roomId).emit('matched', {
      roomId,
      userId,
    });
  }

  // ==========================================
  // SEND MESSAGE
  // ==========================================

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { text: string },
  ) {
    const roomId = this.userRooms.get(socket.id);
    const userId = this.socketUsers.get(socket.id);
    const chatId = this.socketChats.get(socket.id);

    if (!roomId || !userId || !chatId) {
      return;
    }

    if (!data?.text?.trim()) {
      return;
    }

    const text = data.text.trim();

    const message = await this.prisma.message.create({
      data: {
        content: text,
        chatId,
        senderId: userId,
      },
    });

    console.log('Message saved:', message.id);

    this.server.to(roomId).emit('receive_message', {
      text: message.content,
      sender: socket.id,
      timestamp: message.createdAt.getTime(),
    });
  }

  // ==========================================
  // TYPING
  // ==========================================

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() socket: Socket) {
    const roomId = this.userRooms.get(socket.id);

    if (!roomId) {
      return;
    }

    socket.to(roomId).emit('stranger_typing');
  }

  // ==========================================
  // STOP TYPING
  // ==========================================

  @SubscribeMessage('stop_typing')
  stopTyping(@ConnectedSocket() socket: Socket) {
    const roomId = this.userRooms.get(socket.id);

    if (!roomId) {
      return;
    }

    socket.to(roomId).emit('stranger_stopped_typing');
  }

  // ==========================================
  // END CHAT
  // ==========================================

  @SubscribeMessage('end_chat')
  async endChat(@ConnectedSocket() socket: Socket) {
    await this.leaveChat(socket);
  }

  // ==========================================
  // NEXT STRANGER
  // ==========================================

  @SubscribeMessage('next_stranger')
  async nextStranger(@ConnectedSocket() socket: Socket) {
    console.log('User wants next stranger:', socket.id);

    await this.leaveChat(socket);

    // Immediately search for another stranger
    await this.findStranger(socket);
  }

  // ==========================================
  // LEAVE CHAT
  // ==========================================

  private async leaveChat(socket: Socket) {
    const roomId = this.userRooms.get(socket.id);
    const chatId = this.socketChats.get(socket.id);

    if (!roomId) {
      return;
    }

    // Tell the other user
    socket.to(roomId).emit('stranger_left');

    // ==========================================
    // MARK CHAT AS ENDED
    // ==========================================

    if (chatId) {
      const chat = await this.prisma.chat.findUnique({
        where: {
          id: chatId,
        },
        select: {
          endedAt: true,
        },
      });

      if (chat && !chat.endedAt) {
        await this.prisma.chat.update({
          where: {
            id: chatId,
          },
          data: {
            endedAt: new Date(),
          },
        });

        console.log('Chat ended:', chatId);
      }
    }

    socket.leave(roomId);

    this.userRooms.delete(socket.id);
    this.socketChats.delete(socket.id);
  }

  // ==========================================
  // DISCONNECT
  // ==========================================

  async handleDisconnect(socket: Socket) {
    console.log('User disconnected:', socket.id);

    // Remove from waiting queue
    this.waitingUsers = this.waitingUsers.filter(
      (user) => user.id !== socket.id,
    );

    await this.leaveChat(socket);

    this.socketUsers.delete(socket.id);
  }

  // ==========================================
  // CREATE ANONYMOUS DATABASE USER
  // ==========================================

  private async getUserId(socket: Socket): Promise<string | null> {
    const existingUserId = this.socketUsers.get(socket.id);

    if (existingUserId) {
      return existingUserId;
    }

    const user = await this.prisma.user.create({
      data: {},
    });

    this.socketUsers.set(socket.id, user.id);

    console.log('Database user created:', user.id);

    return user.id;
  }
}