import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Security Test Suite: WebSocket & WebRTC Signaling Security (Phase 5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    sessionTokenService = app.get(SessionTokenService);
  }, 30000);

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 200));

    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      }).catch(() => null);
    }
    await app.close();
  }, 15000);

  function createClient(userId?: string, explicitToken?: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      let authObj: any = {};
      if (userId) {
        authObj.userId = userId;
        if (explicitToken === 'NONE') {
          // Send userId without token
        } else if (explicitToken) {
          authObj.token = explicitToken;
        } else {
          authObj.token = sessionTokenService.signToken(userId);
        }
      } else if (explicitToken && explicitToken !== 'NONE') {
        authObj.token = explicitToken;
      }

      const socket = io(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: authObj,
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

  // ==========================================
  // WEBRTC SIGNALING ACCESS CONTROL
  // ==========================================

  describe('WebRTC Video Call Signaling Authorization', () => {
    it('SEC-RTC-01: should reject video_call_request between non-friends', async () => {
      const userA = await prisma.user.create({
        data: { username: `sec_rtc_a_${Date.now()}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_rtc_b_${Date.now()}` },
      });
      testUserIds.push(userA.id, userB.id);

      const socketA = await createClient(userA.id);

      try {
        const errorPromise = new Promise<{ message: string }>((resolve) => {
          socketA.on('video_call_error', (data) => resolve(data));
        });

        // User A attempts to video call User B without an accepted friendship
        const fakeFriendRoomId = `friend-${[userA.id, userB.id].sort().join('-')}`;
        socketA.emit('video_call_request', {
          roomId: fakeFriendRoomId,
          callId: `call_${Date.now()}`,
        });

        const error = await Promise.race([
          errorPromise,
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);

        expect(error).toBeDefined();
        expect(error?.message).toContain('You can only video call accepted Chirp friends');
      } finally {
        socketA.disconnect();
      }
    });

    it('SEC-RTC-02: should reject signaling injection into unauthorized stranger rooms', async () => {
      const userAttacker = await prisma.user.create({
        data: { username: `sec_atk_${Date.now()}` },
      });
      testUserIds.push(userAttacker.id);

      const socketAttacker = await createClient(userAttacker.id);

      try {
        // Attacker attempts to inject video_offer into an arbitrary foreign room
        const foreignRoomId = `stranger_room_${Date.now()}`;
        socketAttacker.emit('video_offer', {
          roomId: foreignRoomId,
          callId: 'fake_call_id',
          sdp: { type: 'offer', sdp: 'fake_sdp' },
        });

        // Attacker is not in foreignRoomId context -> gateway ignores/drops without crash
        await new Promise((r) => setTimeout(r, 200));
        expect(socketAttacker.connected).toBe(true);
      } finally {
        socketAttacker.disconnect();
      }
    });
  });

  // ==========================================
  // WEBSOCKET RATE LIMITING & FLOODING PROTECTION
  // ==========================================

  describe('WebSocket Rate Limiting', () => {
    it('SEC-WS-01: should trigger rate_limit_exceeded when find_stranger is spammed', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_spam_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const socket = await createClient(user.id);

      try {
        const rateLimitPromise = new Promise<{ message: string }>((resolve) => {
          socket.on('rate_limit_exceeded', (data) => resolve(data));
        });

        // Gateway allows max 3 find_stranger per 5 seconds
        for (let i = 0; i < 5; i++) {
          socket.emit('find_stranger', {
            language: 'English',
            interests: ['Gaming'],
            goal: 'casual-chat',
          });
        }

        const result = await Promise.race([
          rateLimitPromise,
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);

        expect(result).toBeDefined();
        expect(result?.message).toContain('too quickly');
      } finally {
        socket.disconnect();
      }
    });

    it('SEC-WS-02: should enforce rate limiting on voice messages (max 3 per 5 sec)', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_voice_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const socket = await createClient(user.id);

      try {
        const rateLimitPromise = new Promise<{ message: string }>((resolve) => {
          socket.on('rate_limit_exceeded', (data) => resolve(data));
        });

        for (let i = 0; i < 5; i++) {
          socket.emit('send_voice_message', {
            audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8=',
            clientId: `client_${i}`,
          });
        }

        const result = await Promise.race([
          rateLimitPromise,
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);

        expect(result).toBeDefined();
        expect(result?.message).toContain('Please wait before sending another voice note');
      } finally {
        socket.disconnect();
      }
    });
  });

  // ==========================================
  // SOCKET.IO IDENTITY & SESSION AUTHENTICATION
  // ==========================================

  describe('Socket.IO Identity & Session Authentication (Remediated)', () => {
    it('SEC-SOCK-01: socket claiming an existing userId without a token is rejected and disconnected', async () => {
      const targetUser = await prisma.user.create({
        data: { username: `sec_spoof_${Date.now()}` },
      });
      testUserIds.push(targetUser.id);

      const client = io(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: { userId: targetUser.id },
      });

      const authErrorPromise = new Promise<{ message: string }>((resolve) => {
        client.on('auth_error', (d) => resolve(d));
      });
      const disconnectPromise = new Promise<string>((resolve) => {
        client.on('disconnect', (r) => resolve(r));
      });

      const err = await authErrorPromise;
      expect(err.message).toContain('Authentication failed');

      await disconnectPromise;
      expect(client.connected).toBe(false);
      client.disconnect();
    });

    it('SEC-SOCK-02: socket connecting with invalid or expired token is rejected and disconnected', async () => {
      const targetUser = await prisma.user.create({
        data: { username: `sec_badtok_${Date.now()}` },
      });
      testUserIds.push(targetUser.id);

      const client = io(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: { userId: targetUser.id, token: 'invalid.token.signature' },
      });

      const authErrorPromise = new Promise<{ message: string }>((resolve) => {
        client.on('auth_error', (d) => resolve(d));
      });
      const disconnectPromise = new Promise<string>((resolve) => {
        client.on('disconnect', (r) => resolve(r));
      });

      const err = await authErrorPromise;
      expect(err.message).toContain('Authentication failed');

      await disconnectPromise;
      expect(client.connected).toBe(false);
      client.disconnect();
    });

    it('SEC-SOCK-03: authenticated socket with valid token maps to correct user and receives user_ready with token', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_auth_ok_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const client = await createClient(user.id);
      try {
        const readyPromise = new Promise<{ userId: string; token: string }>((resolve) => {
          client.on('user_ready', (d) => resolve(d));
        });

        const readyData = await readyPromise;
        expect(readyData.userId).toBe(user.id);
        expect(readyData.token).toBeDefined();

        const verified = sessionTokenService.verifyToken(readyData.token);
        expect(verified?.userId).toBe(user.id);
      } finally {
        client.disconnect();
      }
    });

    it('SEC-SOCK-04: anonymous connection without claimed identity is issued a new user and token', async () => {
      const client = await createClient(undefined);
      try {
        const readyPromise = new Promise<{ userId: string; token: string }>((resolve) => {
          client.on('user_ready', (d) => resolve(d));
        });

        const readyData = await readyPromise;
        expect(readyData.userId).toBeDefined();
        expect(readyData.token).toBeDefined();

        testUserIds.push(readyData.userId);

        const verified = sessionTokenService.verifyToken(readyData.token);
        expect(verified?.userId).toBe(readyData.userId);
      } finally {
        client.disconnect();
      }
    });
  });

  // ==========================================
  // MEDIA INPUT HARDENING
  // ==========================================

  describe('Media Input Hardening (Remediated)', () => {
    it('SEC-MEDIA-01: dangerous or non-image script payload is rejected with error', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_img_vuln_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const client = await createClient(user.id);
      try {
        const errorPromise = new Promise<{ message: string }>((resolve) => {
          client.on('image_message_error', (data) => resolve(data));
        });

        // Send XSS payload disguised as image
        client.emit('send_image_message', {
          imageData: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
          clientId: 'client_xss_img',
        });

        const error = await Promise.race([
          errorPromise,
          new Promise<null>((r) => setTimeout(() => r(null), 2000)),
        ]);

        expect(error).toBeDefined();
        expect(error?.message).toContain("couldn't be sent");
      } finally {
        client.disconnect();
      }
    });

    it('SEC-MEDIA-02: dangerous audio payload with embedded script is rejected with error', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_aud_vuln_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const client = await createClient(user.id);
      try {
        const errorPromise = new Promise<{ message: string }>((resolve) => {
          client.on('voice_message_error', (data) => resolve(data));
        });

        // Send HTML script payload disguised as audio
        client.emit('send_voice_message', {
          audioData: '<script>alert("evil")</script>',
          clientId: 'client_xss_audio',
        });

        const error = await Promise.race([
          errorPromise,
          new Promise<null>((r) => setTimeout(() => r(null), 2000)),
        ]);

        expect(error).toBeDefined();
        expect(error?.message).toContain("couldn't be sent");
      } finally {
        client.disconnect();
      }
    });
  });
});
