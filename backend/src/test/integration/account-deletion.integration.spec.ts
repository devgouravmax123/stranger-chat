import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { UsersService } from '../../users/users.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Account Deletion Integration (Prisma + Redis + WebSocket Cleanup)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let usersService: UsersService;
  let sessionTokenService: SessionTokenService;
  let serverPort: number;

  const testUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    serverPort = typeof address === 'string' ? 3001 : address.port;

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    usersService = app.get(UsersService);
    sessionTokenService = app.get(SessionTokenService);
  }, 30000);

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 200));

    if (testUserIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { userId: { in: testUserIds } },
      }).catch(() => null);

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

  it('should delete account, purge related DB records, clean Redis state, and disconnect active socket', async () => {
    // 1. Create primary test user and a related counterpart user
    const userToDelete = await prisma.user.create({
      data: {
        username: `del_user_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        age: 26,
        gender: 'male',
      },
    });
    const counterpartUser = await prisma.user.create({
      data: {
        username: `del_peer_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      },
    });
    testUserIds.push(userToDelete.id, counterpartUser.id);

    // 2. Create related DB records (notification, friend request)
    await prisma.notification.create({
      data: {
        userId: userToDelete.id,
        type: 'SYSTEM',
        title: 'Delete Test',
        body: 'This notification should be cleaned up on account deletion.',
      },
    });

    await prisma.friendRequest.create({
      data: {
        senderId: userToDelete.id,
        receiverId: counterpartUser.id,
        status: 'PENDING',
      },
    });

    // 3. Connect active WebSocket for userToDelete
    const activeSocket = await createClient(userToDelete.id);
    expect(activeSocket.connected).toBe(true);

    const disconnectPromise = new Promise<string>((resolve) => {
      activeSocket.on('disconnect', (reason) => resolve(reason));
    });

    // 4. Send account deletion request via REST API
    const res = await request(app.getHttpServer())
      .delete(`/users/${userToDelete.id}/account`)
      .set('Authorization', `Bearer ${sessionTokenService.signToken(userToDelete.id)}`)
      .expect(200);

    expect(res.body.success).toBe(true);

    // 5. Verify active socket was forcibly disconnected by deletion hook
    const disconnectReason = await disconnectPromise;
    expect(disconnectReason).toBeDefined();

    // 6. Verify User record is deleted from PostgreSQL
    const deletedUser = await prisma.user.findUnique({
      where: { id: userToDelete.id },
    });
    expect(deletedUser).toBeNull();

    // 7. Verify related notifications were purged
    const remainingNotifs = await prisma.notification.findMany({
      where: { userId: userToDelete.id },
    });
    expect(remainingNotifs.length).toBe(0);

    // 8. Verify related friend requests were purged
    const remainingRequests = await prisma.friendRequest.findMany({
      where: {
        OR: [
          { senderId: userToDelete.id },
          { receiverId: userToDelete.id },
        ],
      },
    });
    expect(remainingRequests.length).toBe(0);

    // 9. Verify Redis presence for user is cleared
    if (redis.getIsConnected()) {
      const isOnline = await redis.isUserOnline(userToDelete.id);
      expect(isOnline).toBe(false);
    }
  });

  it('should return 404 Not Found on repeated deletion attempts', async () => {
    const nonExistentId = `non_existent_${Date.now()}`;

    const res = await request(app.getHttpServer())
      .delete(`/users/${nonExistentId}/account`)
      .set('Authorization', `Bearer ${sessionTokenService.signToken(nonExistentId)}`)
      .expect(404);

    expect(res.body.message).toBe('User not found');
  });
});
