import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Realtime Chat Integration (Socket.IO + Message Flow + Prisma)', () => {
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
    // Allow any pending socket disconnect handlers to complete before deleting DB records
    await new Promise((r) => setTimeout(r, 300));

    if (createdChatIds.length > 0) {
      await prisma.message.deleteMany({
        where: { chatId: { in: createdChatIds } },
      }).catch(() => null);

      await prisma.chat.deleteMany({
        where: { id: { in: createdChatIds } },
      }).catch(() => null);
    }

    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      }).catch(() => null);
    }

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

  async function setupMatchedClients() {
    await new Promise((r) => setTimeout(r, 200));
    if (redis.getIsConnected()) {
      await redis.del('matchmaking:waiting');
    }

    const userA = await prisma.user.create({
      data: {
        username: `chat_user_a_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        language: 'English',
        interests: ['music'],
      },
    });
    const userB = await prisma.user.create({
      data: {
        username: `chat_user_b_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        language: 'English',
        interests: ['music'],
      },
    });
    testUserIds.push(userA.id, userB.id);

    const clientA = await createClient(userA.id);
    const clientB = await createClient(userB.id);

    const matchPromiseA = new Promise<any>((resolve) => clientA.once('matched', resolve));
    const matchPromiseB = new Promise<any>((resolve) => clientB.once('matched', resolve));

    clientA.emit('find_stranger', { language: 'English', interests: ['music'] });
    await new Promise((r) => setTimeout(r, 80));
    clientB.emit('find_stranger', { language: 'English', interests: ['music'] });

    const [matchA] = await Promise.all([matchPromiseA, matchPromiseB]);
    const state = await redis.getMatchState(matchA.roomId);
    if (state?.chatId) {
      createdChatIds.push(state.chatId);
    }

    return { userA, userB, clientA, clientB, roomId: matchA.roomId, chatId: state?.chatId };
  }

  it('should deliver message from client A to client B and persist it in PostgreSQL', async () => {
    const { clientA, clientB, chatId, userA } = await setupMatchedClients();

    try {
      const messageText = `Integration test message at ${Date.now()}`;
      const clientId = `client_msg_${Date.now()}`;

      // 1. Setup listeners
      const ackPromise = new Promise<any>((resolve) => {
        clientA.once('message_sent', resolve);
      });
      const receivePromise = new Promise<any>((resolve) => {
        clientB.once('receive_message', resolve);
      });

      // 2. Client A sends message
      clientA.emit('send_message', {
        text: messageText,
        clientId,
      });

      // 3. Verify real-time reception & ACK
      const [ack, received] = await Promise.all([ackPromise, receivePromise]);

      expect(ack).toBeDefined();
      expect(ack.clientId).toBe(clientId);
      expect(ack.status).toBe('delivered');
      expect(ack.id).toBeDefined();

      expect(received).toBeDefined();
      expect(received.text).toBe(messageText);
      expect(received.senderId).toBe(userA.id);
      expect(received.id).toBe(ack.id);

      // 4. Verify database persistence in PostgreSQL
      if (chatId) {
        const persisted = await prisma.message.findUnique({
          where: { id: ack.id },
        });

        expect(persisted).toBeDefined();
        expect(persisted?.content).toBe(messageText);
        expect(persisted?.chatId).toBe(chatId);
        expect(persisted?.senderId).toBe(userA.id);
        expect(persisted?.status).toBe('delivered');
      }
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it('should broadcast typing start and typing stop indicators to counterpart', async () => {
    const { clientA, clientB } = await setupMatchedClients();

    try {
      // 1. Typing start
      const typingStartPromise = new Promise<void>((resolve) => {
        clientB.once('stranger_typing', () => resolve());
      });

      clientA.emit('typing_start');
      await typingStartPromise;

      // 2. Typing stop
      const typingStopPromise = new Promise<void>((resolve) => {
        clientB.once('stranger_stopped_typing', () => resolve());
      });

      clientA.emit('typing_stop');
      await typingStopPromise;
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it('should notify counterpart when stranger ends chat', async () => {
    const { clientA, clientB } = await setupMatchedClients();

    try {
      const leftPromise = new Promise<void>((resolve) => {
        clientB.once('stranger_left', () => resolve());
      });

      clientA.emit('end_chat');
      await leftPromise;
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  }, 10000);

  it('should handle next_stranger and notify counterpart that stranger skipped', async () => {
    const { clientA, clientB } = await setupMatchedClients();

    try {
      const skippedPromise = new Promise<void>((resolve) => {
        clientB.once('stranger_skipped', () => resolve());
      });

      clientA.emit('next_stranger');
      await skippedPromise;
    } finally {
      clientA.disconnect();
      clientB.disconnect();
      await new Promise((r) => setTimeout(r, 200));
      if (redis.getIsConnected()) {
        await redis.del('matchmaking:waiting');
      }
    }
  }, 10000);

  it('should handle simultaneous client disconnects gracefully without unhandled exceptions', async () => {
    const { clientA, clientB, chatId } = await setupMatchedClients();

    try {
      // Simultaneously disconnect both clients in the same active chat
      clientA.disconnect();
      clientB.disconnect();

      // Allow disconnect processing to settle
      await new Promise((r) => setTimeout(r, 800));

      // Verify chat was marked ended in database
      if (chatId) {
        const chat = await prisma.chat.findUnique({
          where: { id: chatId },
          select: { endedAt: true },
        });
        expect(chat?.endedAt).toBeDefined();
        expect(chat?.endedAt).not.toBeNull();
      }
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  }, 25000);
});

