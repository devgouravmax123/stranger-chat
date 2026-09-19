import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { FriendsService } from '../../friends/friends.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Friend System Integration (FriendsService + Prisma + Notifications + Realtime)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let friendsService: FriendsService;
  let notificationsService: NotificationsService;
  let sessionTokenService: SessionTokenService;
  let serverPort: number;

  const testUserIds: string[] = [];
  const createdChatIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    serverPort = typeof address === 'string' ? 3001 : address.port;

    prisma = app.get(PrismaService);
    friendsService = app.get(FriendsService);
    notificationsService = app.get(NotificationsService);
    sessionTokenService = app.get(SessionTokenService);
  }, 30000);

  afterAll(async () => {
    // Graceful pause for socket closures
    await new Promise((r) => setTimeout(r, 200));

    if (testUserIds.length > 0) {
      // Clean up friendship, requests, notifications, and users
      await prisma.notification.deleteMany({
        where: { userId: { in: testUserIds } },
      }).catch(() => null);

      await prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { senderId: { in: testUserIds } },
            { receiverId: { in: testUserIds } },
          ],
        },
      }).catch(() => null);

      await prisma.friendship.deleteMany({
        where: {
          OR: [
            { userAId: { in: testUserIds } },
            { userBId: { in: testUserIds } },
          ],
        },
      }).catch(() => null);

      if (createdChatIds.length > 0) {
        await prisma.message.deleteMany({
          where: { chatId: { in: createdChatIds } },
        }).catch(() => null);

        await prisma.chat.deleteMany({
          where: { id: { in: createdChatIds } },
        }).catch(() => null);
      }

      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      }).catch(() => null);
    }

    await app.close();
  }, 15000);

  function createClient(userId: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = io(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: { userId, token: sessionTokenService.signToken(userId) },
      });

      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error(`Socket connection timed out for user ${userId}`));
      }, 5000);

      socket.on('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it('should send friend request, persist in DB, generate notification, and deliver realtime socket event', async () => {
    const userSender = await prisma.user.create({
      data: {
        username: `fr_sender_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      },
    });
    const userReceiver = await prisma.user.create({
      data: {
        username: `fr_receiver_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      },
    });
    testUserIds.push(userSender.id, userReceiver.id);

    // Connect receiver socket to listen for real-time notification
    const receiverSocket = await createClient(userReceiver.id);

    try {
      const notifReceivedPromise = new Promise<any>((resolve) => {
        receiverSocket.once('new_notification', (data) => resolve(data));
      });

      // Send friend request via real FriendsService
      const requestResult = await friendsService.sendFriendRequest(userSender.id, userReceiver.id);
      expect(requestResult.message).toBe('Friend request sent');
      expect(requestResult.requestId).toBeDefined();

      // 1. Verify DB persistence of friend request
      const persistedRequest = await prisma.friendRequest.findUnique({
        where: { id: requestResult.requestId },
      });
      expect(persistedRequest).toBeDefined();
      expect(persistedRequest?.senderId).toBe(userSender.id);
      expect(persistedRequest?.receiverId).toBe(userReceiver.id);
      expect(persistedRequest?.status).toBe('PENDING');

      // 2. Verify DB persistence of notification
      const notifications = await notificationsService.getNotifications(userReceiver.id);
      expect(notifications.length).toBeGreaterThanOrEqual(1);
      const friendRequestNotif = notifications.find(
        (n) => n.senderId === userSender.id || n.type === 'FRIEND_REQUEST',
      );
      expect(friendRequestNotif).toBeDefined();

      // 3. Verify realtime event delivered to receiver's socket
      const realtimeNotif = await notifReceivedPromise;
      expect(realtimeNotif).toBeDefined();
      expect(realtimeNotif.type).toBe('FRIEND_REQUEST');
    } finally {
      receiverSocket.disconnect();
    }
  });

  it('should accept friend request, create friendship in DB, and notify sender', async () => {
    const userA = await prisma.user.create({
      data: { username: `fr_acc_a_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    const userB = await prisma.user.create({
      data: { username: `fr_acc_b_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    testUserIds.push(userA.id, userB.id);

    const clientA = await createClient(userA.id);

    try {
      // User A sends request to User B
      const req = await friendsService.sendFriendRequest(userA.id, userB.id);

      const acceptedNotifPromise = new Promise<any>((resolve) => {
        clientA.once('new_notification', (data) => resolve(data));
      });

      // User B accepts request
      const acceptResult = await friendsService.acceptFriendRequest(req.requestId, userB.id);
      expect(acceptResult.message).toBe('Friend request accepted');
      expect(acceptResult.status).toBe('ACCEPTED');
      if (acceptResult.chatId) {
        createdChatIds.push(acceptResult.chatId);
      }

      // Verify Friendship record exists in PostgreSQL
      const friendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { userAId: userA.id, userBId: userB.id },
            { userAId: userB.id, userBId: userA.id },
          ],
        },
      });
      expect(friendship).toBeDefined();

      // Verify friends query returns counterpart
      const friendsOfA = await friendsService.getFriends(userA.id);
      expect(friendsOfA.some((f) => f.friend.id === userB.id)).toBe(true);

      // Verify User A received realtime accepted notification
      const acceptedNotif = await acceptedNotifPromise;
      expect(acceptedNotif).toBeDefined();
      expect(acceptedNotif.type).toBe('FRIEND_ACCEPTED');
    } finally {
      clientA.disconnect();
    }
  });

  it('should reject friend request and remove pending status from DB', async () => {
    const userA = await prisma.user.create({
      data: { username: `fr_rej_a_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    const userB = await prisma.user.create({
      data: { username: `fr_rej_b_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    testUserIds.push(userA.id, userB.id);

    const req = await friendsService.sendFriendRequest(userA.id, userB.id);

    // User B rejects request
    const rejectResult = await friendsService.rejectFriendRequest(req.requestId, userB.id);
    expect(rejectResult.message).toBe('Friend request rejected');
    expect(rejectResult.status).toBe('REJECTED');

    // Verify request is no longer PENDING in DB
    const checkReq = await prisma.friendRequest.findUnique({
      where: { id: req.requestId },
    });
    expect(checkReq?.status).not.toBe('PENDING');

    // Verify no friendship was created
    const checkFriendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userAId: userA.id, userBId: userB.id },
          { userAId: userB.id, userBId: userA.id },
        ],
      },
    });
    expect(checkFriendship).toBeNull();
  });

  it('should remove existing friendship when removeFriend is invoked', async () => {
    const userA = await prisma.user.create({
      data: { username: `fr_rem_a_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    const userB = await prisma.user.create({
      data: { username: `fr_rem_b_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    testUserIds.push(userA.id, userB.id);

    // Setup friendship
    const req = await friendsService.sendFriendRequest(userA.id, userB.id);
    const accepted = await friendsService.acceptFriendRequest(req.requestId, userB.id);
    if (accepted.chatId) {
      createdChatIds.push(accepted.chatId);
    }

    // Verify friendship exists before removal
    const initialFriends = await friendsService.getFriends(userA.id);
    expect(initialFriends.some((f) => f.friend.id === userB.id)).toBe(true);

    // Remove friendship
    const removeResult = await friendsService.removeFriend(userA.id, userB.id);
    expect(removeResult.message).toBe('Friend removed');

    // Verify friendship no longer exists in DB
    const remainingFriends = await friendsService.getFriends(userA.id);
    expect(remainingFriends.some((f) => f.friend.id === userB.id)).toBe(false);
  });
});
