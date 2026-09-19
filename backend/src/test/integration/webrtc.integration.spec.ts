import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('WebRTC Signaling Integration (Socket.IO + Gateway Signaling Routing)', () => {
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
    await new Promise((r) => setTimeout(r, 200));

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
    const userA = await prisma.user.create({
      data: { username: `webrtc_u_a_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    const userB = await prisma.user.create({
      data: { username: `webrtc_u_b_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    testUserIds.push(userA.id, userB.id);

    const clientA = await createClient(userA.id);
    const clientB = await createClient(userB.id);

    const matchPromiseA = new Promise<any>((resolve) => clientA.once('matched', resolve));
    const matchPromiseB = new Promise<any>((resolve) => clientB.once('matched', resolve));

    clientA.emit('find_stranger', { language: 'English' });
    await new Promise((r) => setTimeout(r, 80));
    clientB.emit('find_stranger', { language: 'English' });

    const [matchA] = await Promise.all([matchPromiseA, matchPromiseB]);
    const state = await redis.getMatchState(matchA.roomId);
    if (state?.chatId) {
      createdChatIds.push(state.chatId);
    }

    return { userA, userB, clientA, clientB, roomId: matchA.roomId };
  }

  it('should route complete WebRTC signaling handshake (call request, accept, offer, answer, ice candidate, end)', async () => {
    const { clientA, clientB, roomId, userA } = await setupMatchedClients();

    const callId = `call_${Date.now()}`;

    try {
      // 1. Client A initiates video call request
      const callRequestPromise = new Promise<any>((resolve) => {
        clientB.once('video_call_request', resolve);
      });

      clientA.emit('video_call_request', { roomId, callId });

      const incomingRequest = await callRequestPromise;
      expect(incomingRequest).toBeDefined();
      expect(incomingRequest.callId).toBe(callId);
      expect(incomingRequest.roomId).toBe(roomId);
      expect(incomingRequest.callerUserId).toBe(userA.id);

      // 2. Client B accepts the video call
      const callAcceptedPromise = new Promise<any>((resolve) => {
        clientA.once('video_call_accepted', resolve);
      });

      clientB.emit('video_call_accepted', { roomId, callId });

      const acceptedData = await callAcceptedPromise;
      expect(acceptedData).toBeDefined();
      expect(acceptedData.callId).toBe(callId);

      // 3. Client A sends WebRTC SDP Offer
      const mockOfferSdp = { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1...' };
      const offerPromise = new Promise<any>((resolve) => {
        clientB.once('video_offer', resolve);
      });

      clientA.emit('video_offer', { roomId, callId, sdp: mockOfferSdp });

      const receivedOffer = await offerPromise;
      expect(receivedOffer).toBeDefined();
      expect(receivedOffer.sdp).toEqual(mockOfferSdp);

      // 4. Client B sends WebRTC SDP Answer
      const mockAnswerSdp = { type: 'answer', sdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1...' };
      const answerPromise = new Promise<any>((resolve) => {
        clientA.once('video_answer', resolve);
      });

      clientB.emit('video_answer', { roomId, callId, sdp: mockAnswerSdp });

      const receivedAnswer = await answerPromise;
      expect(receivedAnswer).toBeDefined();
      expect(receivedAnswer.sdp).toEqual(mockAnswerSdp);

      // 5. ICE candidate exchange
      const mockCandidate = { candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 54321 typ host', sdpMLineIndex: 0 };
      const icePromise = new Promise<any>((resolve) => {
        clientB.once('video_ice_candidate', resolve);
      });

      clientA.emit('video_ice_candidate', { roomId, callId, candidate: mockCandidate });

      const receivedCandidate = await icePromise;
      expect(receivedCandidate).toBeDefined();
      expect(receivedCandidate.candidate).toEqual(mockCandidate);

      // 6. Call termination
      const callEndPromise = new Promise<any>((resolve) => {
        clientB.once('video_call_ended', resolve);
      });

      clientA.emit('video_call_ended', { roomId, callId });

      const endData = await callEndPromise;
      expect(endData).toBeDefined();
      expect(endData.roomId).toBe(roomId);
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it('should route video_call_declined when recipient declines call', async () => {
    const { clientA, clientB, roomId } = await setupMatchedClients();
    const callId = `call_dec_${Date.now()}`;

    try {
      const callRequestPromise = new Promise<any>((resolve) => {
        clientB.once('video_call_request', resolve);
      });

      clientA.emit('video_call_request', { roomId, callId });
      await callRequestPromise;

      const declinePromise = new Promise<any>((resolve) => {
        clientA.once('video_call_declined', resolve);
      });

      clientB.emit('video_call_declined', { roomId, callId, reason: 'declined' });

      const declineData = await declinePromise;
      expect(declineData).toBeDefined();
      expect(declineData.callId).toBe(callId);
      expect(declineData.reason).toBe('declined');
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });
});
