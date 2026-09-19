import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Matchmaking Integration (Socket.IO + Redis + MatchingService)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
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
    redis = app.get(RedisService);
    sessionTokenService = app.get(SessionTokenService);
  }, 30000);

  afterAll(async () => {
    // Cleanup any chats created during tests
    if (createdChatIds.length > 0) {
      await prisma.message.deleteMany({
        where: { chatId: { in: createdChatIds } },
      }).catch(() => null);

      await prisma.chat.deleteMany({
        where: { id: { in: createdChatIds } },
      }).catch(() => null);
    }

    // Cleanup test users
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      }).catch(() => null);
    }

    // Clear Redis waiting queue
    if (redis.getIsConnected()) {
      await redis.del('matchmaking:waiting');
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

  it('should match two distinct users entering the matchmaking queue and emit matched events', async () => {
    // 1. Create two test users in PostgreSQL
    const userA = await prisma.user.create({
      data: {
        username: `int_user_a_${Date.now()}`,
        gender: 'male',
        age: 25,
        language: 'English',
        interests: ['coding', 'music'],
        goal: 'casual-chat',
      },
    });
    const userB = await prisma.user.create({
      data: {
        username: `int_user_b_${Date.now()}`,
        gender: 'female',
        age: 24,
        language: 'English',
        interests: ['coding', 'gaming'],
        goal: 'casual-chat',
      },
    });
    testUserIds.push(userA.id, userB.id);

    // 2. Connect both clients over real Socket.IO
    const clientA = await createClient(userA.id);
    const clientB = await createClient(userB.id);

    try {
      // 3. Client A joins matchmaking queue
      const waitingPromise = new Promise<void>((resolve) => {
        clientA.once('waiting', () => resolve());
      });

      clientA.emit('find_stranger', {
        language: 'English',
        interests: ['coding'],
        goal: 'casual-chat',
      });

      await waitingPromise;

      // Verify Redis queue contains user
      if (redis.getIsConnected()) {
        const queueLen = await redis.getWaitingQueueLength();
        expect(queueLen).toBeGreaterThanOrEqual(1);
      }

      // 4. Setup matched event listeners for both clients
      const matchPromiseA = new Promise<any>((resolve) => {
        clientA.once('matched', (data) => resolve(data));
      });
      const matchPromiseB = new Promise<any>((resolve) => {
        clientB.once('matched', (data) => resolve(data));
      });

      // 5. Client B joins matchmaking queue
      clientB.emit('find_stranger', {
        language: 'English',
        interests: ['coding'],
        goal: 'casual-chat',
      });

      // Both should receive matched event
      const [matchA, matchB] = await Promise.all([matchPromiseA, matchPromiseB]);

      // 6. Assert match integrity
      expect(matchA).toBeDefined();
      expect(matchB).toBeDefined();

      // Same room
      expect(matchA.roomId).toBe(matchB.roomId);

      // Correct counterparts (no self-match)
      expect(matchA.userId).toBe(userA.id);
      expect(matchA.strangerUserId).toBe(userB.id);

      expect(matchB.userId).toBe(userB.id);
      expect(matchB.strangerUserId).toBe(userA.id);

      // Compatibility score exists
      expect(typeof matchA.score).toBe('number');
      expect(matchA.score).toBeGreaterThan(0);

      // Track created chat for cleanup
      const state = await redis.getMatchState(matchA.roomId);
      if (state?.chatId) {
        createdChatIds.push(state.chatId);
      }
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it('should prevent self-match when the same client requests stranger twice', async () => {
    const userSelf = await prisma.user.create({
      data: {
        username: `int_self_${Date.now()}`,
      },
    });
    testUserIds.push(userSelf.id);

    const client = await createClient(userSelf.id);

    try {
      let matchCount = 0;
      client.on('matched', () => {
        matchCount++;
      });

      client.emit('find_stranger', { language: 'English' });
      await new Promise((r) => setTimeout(r, 200));

      // Attempt to match with oneself
      client.emit('find_stranger', { language: 'English' });
      await new Promise((r) => setTimeout(r, 300));

      // Self-match must never occur
      expect(matchCount).toBe(0);
    } finally {
      client.disconnect();
    }
  });

  it('should handle disconnect while waiting in queue without orphaned match', async () => {
    const userDisconnect = await prisma.user.create({
      data: {
        username: `int_disc_${Date.now()}`,
      },
    });
    testUserIds.push(userDisconnect.id);

    const client = await createClient(userDisconnect.id);
    client.emit('find_stranger', { language: 'English' });
    await new Promise((r) => setTimeout(r, 150));

    // Client disconnects while waiting
    client.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    // Now a new user enters queue
    const userNormal = await prisma.user.create({
      data: {
        username: `int_norm_${Date.now()}`,
      },
    });
    testUserIds.push(userNormal.id);

    const clientNormal = await createClient(userNormal.id);
    try {
      const waitingReceived = new Promise<boolean>((resolve) => {
        clientNormal.once('waiting', () => resolve(true));
      });

      clientNormal.emit('find_stranger', { language: 'English' });
      const result = await waitingReceived;

      // Must wait because the disconnected user was safely dropped
      expect(result).toBe(true);
    } finally {
      clientNormal.disconnect();
    }
  });
});
