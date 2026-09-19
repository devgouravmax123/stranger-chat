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
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
  maxHttpBufferSize: 1e7,
})
export class FriendsGateway {
  @WebSocketServer()
  server!: Server;

  // database user ID -> socket ID
  private onlineUsers = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // FRIEND USER ONLINE
  // ==========================================

  @SubscribeMessage('friend_online')
  friendOnline(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    data: {
      userId: string;
    },
  ) {
    if (!data?.userId) {
      return;
    }

    this.onlineUsers.set(
      data.userId,
      socket.id,
    );

    console.log(
      'Friend user online:',
      data.userId,
      socket.id,
    );
  }

  // ==========================================
  // OPEN PRIVATE FRIEND ROOM
  // ==========================================

  @SubscribeMessage('open_friend_room')
  async openFriendRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    data: {
      userId: string;
      friendId: string;
    },
  ) {
    if (
      !data?.userId ||
      !data?.friendId
    ) {
      return;
    }

    // Make sure the socket belongs to this user
    const registeredSocket =
      this.onlineUsers.get(
        data.userId,
      );

    if (
      registeredSocket &&
      registeredSocket !== socket.id
    ) {
      socket.emit(
        'friend_room_error',
        {
          message:
            'User session mismatch',
        },
      );

      return;
    }

    // ==========================================
    // CHECK FRIENDSHIP
    // ==========================================

    const friendship =
      await this.prisma.friendship.findFirst({
        where: {
          OR: [
            {
              userAId: data.userId,
              userBId: data.friendId,
            },
            {
              userAId: data.friendId,
              userBId: data.userId,
            },
          ],
        },
      });

    if (!friendship) {
      socket.emit(
        'friend_room_error',
        {
          message:
            'You are not friends with this user',
        },
      );

      return;
    }

    // ==========================================
    // CREATE PRIVATE CHAT IF NEEDED
    // ==========================================

    let chatId =
      friendship.chatId;

    if (!chatId) {
      const chat =
        await this.prisma.chat.create({
          data: {
            userAId:
              friendship.userAId,

            userBId:
              friendship.userBId,
          },
        });

      chatId = chat.id;

      await this.prisma.friendship.update({
        where: {
          id: friendship.id,
        },
        data: {
          chatId,
        },
      });

      console.log(
        'Private friend chat created:',
        chatId,
      );
    }

    // ==========================================
    // ROOM ID
    // ==========================================

    const roomId =
      `friend-${friendship.id}`;

    // Join socket to private room
    socket.join(roomId);

    // ==========================================
    // LOAD CHAT HISTORY
    // ==========================================

    const messages =
      await this.prisma.message.findMany({
        where: {
          chatId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

    // ==========================================
    // SEND ROOM + HISTORY
    // ==========================================

    socket.emit(
      'friend_room_opened',
      {
        roomId,
        friendId:
          data.friendId,
        messages,
      },
    );

    console.log(
      'Friend room opened:',
      roomId,
      'for user:',
      data.userId,
    );

    console.log(
      'Friend chat history:',
      messages.length,
      'messages',
    );
  }

  // ==========================================
  // SEND FRIEND MESSAGE
  // ==========================================

  @SubscribeMessage(
    'send_friend_message',
  )
  async sendFriendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    data: {
      roomId: string;
      senderId: string;
      text: string;
    },
  ) {
    if (
      !data?.roomId ||
      !data?.senderId ||
      !data?.text?.trim()
    ) {
      return;
    }

    const text =
      data.text.trim();

    // ==========================================
    // VERIFY SENDER
    // ==========================================

    const registeredSocket =
      this.onlineUsers.get(
        data.senderId,
      );

    if (
      registeredSocket &&
      registeredSocket !== socket.id
    ) {
      return;
    }

    // ==========================================
    // VERIFY ROOM
    // ==========================================

    if (
      !socket.rooms.has(
        data.roomId,
      )
    ) {
      return;
    }

    // ==========================================
    // GET FRIENDSHIP
    // ==========================================

    const friendshipId =
      data.roomId.replace(
        'friend-',
        '',
      );

    const friendship =
      await this.prisma.friendship.findUnique(
        {
          where: {
            id: friendshipId,
          },
        },
      );

    if (!friendship) {
      socket.emit(
        'friend_room_error',
        {
          message:
            'Friendship not found',
        },
      );

      return;
    }

    // ==========================================
    // VERIFY SENDER IS ONE OF THE FRIENDS
    // ==========================================

    const isFriend =
      friendship.userAId ===
        data.senderId ||
      friendship.userBId ===
        data.senderId;

    if (!isFriend) {
      return;
    }

    // ==========================================
    // GET / CREATE PRIVATE CHAT
    // ==========================================

    let chatId =
      friendship.chatId;

    if (!chatId) {
      const chat =
        await this.prisma.chat.create({
          data: {
            userAId:
              friendship.userAId,

            userBId:
              friendship.userBId,
          },
        });

      chatId = chat.id;

      await this.prisma.friendship.update({
        where: {
          id: friendship.id,
        },
        data: {
          chatId,
        },
      });

      console.log(
        'Private friend chat created while sending message:',
        chatId,
      );
    }

    // ==========================================
    // SAVE MESSAGE
    // ==========================================

    const message =
      await this.prisma.message.create({
        data: {
          content: text,
          senderId:
            data.senderId,
          chatId,
        },
      });

    console.log(
      'Friend message saved:',
      message.id,
    );

    // ==========================================
    // SEND TO BOTH FRIENDS
    // ==========================================

    this.server
      .to(data.roomId)
      .emit(
        'receive_friend_message',
        {
          id: message.id,

          text:
            message.content,

          senderId:
            message.senderId,

          timestamp:
            message.createdAt.getTime(),
        },
      );
  }

  // ==========================================
  // LEAVE FRIEND ROOM
  // ==========================================

  @SubscribeMessage(
    'leave_friend_room',
  )
  leaveFriendRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    data: {
      roomId: string;
    },
  ) {
    if (!data?.roomId) {
      return;
    }

    socket.leave(
      data.roomId,
    );

    console.log(
      'Left friend room:',
      data.roomId,
      socket.id,
    );
  }

  // ==========================================
  // DISCONNECT
  // ==========================================

  handleDisconnect(
    socket: Socket,
  ) {
    for (
      const [
        userId,
        socketId,
      ] of this.onlineUsers.entries()
    ) {
      if (
        socketId === socket.id
      ) {
        this.onlineUsers.delete(
          userId,
        );

        console.log(
          'Friend user offline:',
          userId,
        );

        break;
      }
    }
  }
}