import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatGateway } from './chat.gateway.js';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UsersService } from '../users/users.service.js';
import { FriendsService } from '../friends/friends.service.js';
import { MatchingService } from './matching.service.js';
import { SessionTokenService } from '../auth/session-token.service.js';

describe('ChatGateway - Concurrent leaveChat race condition handling', () => {
  let gateway: ChatGateway;
  let mockPrisma: any;
  let mockRedis: any;
  let mockNotifications: any;
  let mockUsersService: any;
  let mockFriendsService: any;
  let mockMatchingService: any;
  let mockSessionTokenService: any;

  beforeEach(() => {
    mockPrisma = {
      chat: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      user: {
        update: vi.fn().mockResolvedValue({}),
      },
      friendship: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockRedis = {
      getIsConnected: vi.fn().mockReturnValue(true),
      getSocketMapping: vi.fn(),
      removeMatchState: vi.fn().mockResolvedValue(undefined),
      setPresence: vi.fn().mockResolvedValue(undefined),
      setSocketMapping: vi.fn().mockResolvedValue(undefined),
      removeWaitingUserBySocketId: vi.fn().mockResolvedValue(undefined),
      removePresence: vi.fn().mockResolvedValue(undefined),
      removeSocketMapping: vi.fn().mockResolvedValue(undefined),
      removeUserSocketPresence: vi.fn().mockResolvedValue(0),
    };

    mockNotifications = {};
    mockUsersService = {};
    mockFriendsService = {};
    mockMatchingService = {};
    mockSessionTokenService = {};

    gateway = new ChatGateway(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
      mockNotifications as unknown as NotificationsService,
      mockUsersService as unknown as UsersService,
      mockFriendsService as unknown as FriendsService,
      mockMatchingService as unknown as MatchingService,
      mockSessionTokenService as unknown as SessionTokenService,
    );

    gateway.server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      sockets: { sockets: new Map() },
    } as any;
  });

  function createMockSocket(id: string) {
    return {
      id,
      handshake: { auth: {} },
      leave: vi.fn(),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      emit: vi.fn(),
    } as any;
  }

  it('should handle concurrent leaveChat calls gracefully when second call receives Prisma P2025', async () => {
    const socketA = createMockSocket('socket-a');
    const socketB = createMockSocket('socket-b');

    const chatId = 'chat-race-123';
    const roomId = 'room-race-123';

    mockRedis.getSocketMapping.mockImplementation(async (sId: string) => {
      return { roomId, chatId, userId: `user-${sId}` };
    });

    // Both operations read chat before commit and see endedAt: null
    mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: null });

    // Operation A succeeds in updating
    // Operation B arrives concurrently and encounters Prisma P2025
    const p2025Error = new Error(
      'An operation failed because it depends on one or more records that were required but not found. No record was found for an update.',
    );
    (p2025Error as any).code = 'P2025';

    let updateCount = 0;
    mockPrisma.chat.update.mockImplementation(async () => {
      updateCount++;
      if (updateCount === 1) {
        return { id: chatId, endedAt: new Date() };
      }
      throw p2025Error;
    });

    // Execute both concurrently
    const leavePromiseA = gateway['leaveChat'](socketA, 'ended');
    const leavePromiseB = gateway['leaveChat'](socketB, 'ended');

    // Both must resolve without throwing an unhandled exception
    await expect(Promise.all([leavePromiseA, leavePromiseB])).resolves.toBeDefined();

    // Verify chat.update was attempted for both
    expect(mockPrisma.chat.update).toHaveBeenCalledTimes(2);

    // Verify socket cleanup occurred for both sockets despite P2025 on second socket
    expect(socketA.leave).toHaveBeenCalledWith(roomId);
    expect(socketB.leave).toHaveBeenCalledWith(roomId);

    // Verify Redis cleanup completed for both sockets
    expect(mockRedis.removeMatchState).toHaveBeenCalledWith(roomId);
    expect(mockRedis.setPresence).toHaveBeenCalledWith('socket-a', 'online');
    expect(mockRedis.setPresence).toHaveBeenCalledWith('socket-b', 'online');
    expect(mockRedis.setSocketMapping).toHaveBeenCalledWith('socket-a', { roomId: undefined, chatId: undefined });
    expect(mockRedis.setSocketMapping).toHaveBeenCalledWith('socket-b', { roomId: undefined, chatId: undefined });
  });

  it('should handle handleDisconnect with concurrent P2025 without crashing the process', async () => {
    vi.useFakeTimers();
    const socket = createMockSocket('socket-disconnect');
    const chatId = 'chat-disconnect-456';
    const roomId = 'room-disconnect-456';

    mockRedis.getSocketMapping.mockResolvedValue({ roomId, chatId, userId: 'user-disconnect' });
    mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: null });

    const p2025Error = new Error('No record was found for an update.');
    (p2025Error as any).code = 'P2025';
    mockPrisma.chat.update.mockRejectedValue(p2025Error);

    // Must resolve cleanly without throwing
    await expect(gateway.handleDisconnect(socket)).resolves.toBeUndefined();

    // Advance 15-second disconnect grace timer to simulate unrecovered disconnect
    await vi.advanceTimersByTimeAsync(15000);

    // Sockets left and Redis cleaned up
    expect(socket.leave).toHaveBeenCalledWith(roomId);
    expect(mockRedis.removePresence).toHaveBeenCalledWith('socket-disconnect');
    expect(mockRedis.removeSocketMapping).toHaveBeenCalledWith('socket-disconnect');
    vi.useRealTimers();
  });

  it('should rethrow non-P2025 errors so unexpected database errors are not hidden', async () => {
    const socket = createMockSocket('socket-err');
    const chatId = 'chat-err-789';
    const roomId = 'room-err-789';

    mockRedis.getSocketMapping.mockResolvedValue({ roomId, chatId, userId: 'user-err' });
    mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: null });

    const unexpectedDbError = new Error('Database connection lost');
    (unexpectedDbError as any).code = 'P1001';
    mockPrisma.chat.update.mockRejectedValue(unexpectedDbError);

    await expect(gateway['leaveChat'](socket, 'ended')).rejects.toThrow('Database connection lost');
  });
});

describe('ChatGateway - Phase 3 Step 2 Backend E2EE Transport & Storage', () => {
  let gateway: ChatGateway;
  let mockPrisma: any;
  let mockRedis: any;
  let mockNotifications: any;
  let mockUsersService: any;
  let mockFriendsService: any;
  let mockMatchingService: any;
  let mockSessionTokenService: any;

  const validEnvelope = {
    e2ee: true,
    v: 1,
    iv: 'MTIzNDU2Nzg5MDEy', // 12-byte base64
    ct: 'dGVzdC1jaXBoZXJ0ZXh0LXdpdGgtYXV0aC10YWc=',
  };

  beforeEach(() => {
    mockPrisma = {
      message: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      chat: {
        findUnique: vi.fn().mockResolvedValue({ endedAt: null }),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      friendship: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockRedis = {
      getIsConnected: vi.fn().mockReturnValue(true),
      checkRateLimit: vi.fn().mockResolvedValue(true),
      getSocketMapping: vi.fn(),
      setSocketMapping: vi.fn().mockResolvedValue(undefined),
      setPresence: vi.fn().mockResolvedValue(undefined),
      removePresence: vi.fn().mockResolvedValue(undefined),
      removeSocketMapping: vi.fn().mockResolvedValue(undefined),
      addUserSocketPresence: vi.fn().mockResolvedValue(1),
      removeUserSocketPresence: vi.fn().mockResolvedValue(0),
      removeWaitingUserBySocketId: vi.fn().mockResolvedValue(undefined),
      removeMatchState: vi.fn().mockResolvedValue(undefined),
      setUserActiveMatch: vi.fn().mockResolvedValue(undefined),
      getUserActiveMatch: vi.fn().mockResolvedValue(null),
      removeUserActiveMatch: vi.fn().mockResolvedValue(undefined),
    };

    mockNotifications = {
      createNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    mockUsersService = {};
    mockFriendsService = {};
    mockMatchingService = {};
    mockSessionTokenService = {};

    gateway = new ChatGateway(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
      mockNotifications as unknown as NotificationsService,
      mockUsersService as unknown as UsersService,
      mockFriendsService as unknown as FriendsService,
      mockMatchingService as unknown as MatchingService,
      mockSessionTokenService as unknown as SessionTokenService,
    );

    gateway.server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      sockets: { sockets: new Map() },
    } as any;
  });

  function createMockSocket(id: string) {
    return {
      id,
      handshake: { auth: {} },
      leave: vi.fn(),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      emit: vi.fn(),
    } as any;
  }

  describe('Envelope validation (isValidE2EEEnvelope)', () => {
    it('should accept valid 12-byte IV and non-empty ciphertext', async () => {
      const { isValidE2EEEnvelope } = await import('./dto/e2ee-envelope.dto.js');
      expect(isValidE2EEEnvelope(validEnvelope)).toBe(true);
    });

    it('should reject malformed or invalid envelopes', async () => {
      const { isValidE2EEEnvelope } = await import('./dto/e2ee-envelope.dto.js');
      expect(isValidE2EEEnvelope(null)).toBe(false);
      expect(isValidE2EEEnvelope({})).toBe(false);
      expect(isValidE2EEEnvelope({ ...validEnvelope, e2ee: false })).toBe(false);
      expect(isValidE2EEEnvelope({ ...validEnvelope, v: 2 })).toBe(false);
      expect(isValidE2EEEnvelope({ ...validEnvelope, iv: 'not-12-bytes' })).toBe(false);
      expect(isValidE2EEEnvelope({ ...validEnvelope, ct: '' })).toBe(false);
      expect(isValidE2EEEnvelope({ ...validEnvelope, iv: '!invalid-base64!' })).toBe(false);
    });
  });

  describe('Stranger sendMessage with E2EE envelope', () => {
    it('should persist serialized envelope into Message.content and emit envelope to stranger without text field', async () => {
      const socket = createMockSocket('sock-sender');
      const roomId = 'room-123';
      const userId = 'user-alice';
      const chatId = 'chat-123';

      mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId, chatId });

      const mockCreatedMessage = {
        id: 'msg-uuid-1',
        content: JSON.stringify(validEnvelope),
        chatId,
        senderId: userId,
        createdAt: new Date(1700000000000),
        status: 'delivered',
        replyTo: null,
      };
      mockPrisma.message.create.mockResolvedValue(mockCreatedMessage);

      await gateway.sendMessage(socket, {
        envelope: validEnvelope as any,
        clientId: 'client-1',
      });

      // Assert database storage: content is opaque JSON envelope string, NOT plaintext
      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: {
          content: JSON.stringify(validEnvelope),
          chatId,
          senderId: userId,
          replyToId: null,
          status: 'delivered',
          deliveredAt: expect.any(Date),
        },
        include: {
          replyTo: true,
          reactions: true,
        },
      });

      // Assert broadcast: emits envelope property, NO text property
      const roomBroadcastMock = socket.to(roomId).emit;
      expect(roomBroadcastMock).toHaveBeenCalledWith('receive_message', {
        id: 'msg-uuid-1',
        clientId: 'client-1',
        envelope: validEnvelope,
        senderId: userId,
        timestamp: 1700000000000,
        type: 'text',
        status: 'delivered',
        replyTo: null,
      });

      const broadcastPayload = roomBroadcastMock.mock.calls[0][1];
      expect(broadcastPayload.text).toBeUndefined();
    });

    it('should reject malformed envelope with message_error', async () => {
      const socket = createMockSocket('sock-sender');
      mockRedis.getSocketMapping.mockResolvedValue({ roomId: 'r1', userId: 'u1', chatId: 'c1' });

      await gateway.sendMessage(socket, {
        envelope: { e2ee: false } as any,
        clientId: 'client-malformed',
      });

      expect(mockPrisma.message.create).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('message_error', {
        clientId: 'client-malformed',
        message: 'Invalid E2EE message envelope',
      });
    });
  });

  describe('Friend sendFriendMessage with E2EE envelope', () => {
    it('should persist serialized envelope and emit generic notification without plaintext or ciphertext preview', async () => {
      const socket = createMockSocket('sock-friend-sender');
      const roomId = 'friend-u1-u2';
      const senderId = 'u1';
      const receiverId = 'u2';
      const chatId = 'chat-friend-1';

      mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId: senderId, chatId });
      mockPrisma.chat.findUnique.mockResolvedValue({ userAId: senderId, userBId: receiverId });
      mockPrisma.user.findUnique.mockResolvedValue({ username: 'Alice' });

      const mockCreatedMessage = {
        id: 'friend-msg-1',
        content: JSON.stringify(validEnvelope),
        chatId,
        senderId,
        createdAt: new Date(1700000005000),
        status: 'sent',
        replyTo: null,
      };
      mockPrisma.message.create.mockResolvedValue(mockCreatedMessage);

      await gateway.sendFriendMessage(socket, {
        roomId,
        senderId,
        envelope: validEnvelope as any,
        clientId: 'client-friend-123',
      });

      // Assert DB persistence
      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: {
          content: JSON.stringify(validEnvelope),
          chatId,
          senderId,
          replyToId: null,
          status: 'sent',
        },
        include: { replyTo: true },
      });

      // Assert friend broadcast contains envelope, clientId, and NO text property
      const serverToMock = (gateway.server.to as any)(roomId).emit;
      expect(serverToMock).toHaveBeenCalledWith('receive_friend_message', {
        id: 'friend-msg-1',
        clientId: 'client-friend-123',
        envelope: validEnvelope,
        senderId,
        timestamp: 1700000005000,
        type: 'text',
        status: 'sent',
        replyTo: null,
      });
      const friendPayload = serverToMock.mock.calls[0][1];
      expect(friendPayload.text).toBeUndefined();
      expect(friendPayload.clientId).toBe('client-friend-123');

      // Assert friend_message_sent ACK was emitted to sender
      expect(socket.emit).toHaveBeenCalledWith('friend_message_sent', {
        id: 'friend-msg-1',
        clientId: 'client-friend-123',
        status: 'sent',
      });

      // Assert notification body is strictly generic
      expect(mockNotifications.createNotification).toHaveBeenCalledWith({
        userId: receiverId,
        type: 'NEW_MESSAGE',
        title: 'New message from Alice',
        body: 'New encrypted message',
        data: { friendId: senderId, chatId, roomId },
      });
    });
  });

  describe('getFormattedMessages history & reply handling', () => {
    it('should return envelope without text for E2EE rows, and preserve text for legacy plaintext rows', async () => {
      const chatId = 'chat-hist-1';
      const currentUserId = 'user-alice';

      const legacyMessage = {
        id: 'legacy-1',
        content: 'Historical plaintext message',
        senderId: 'user-bob',
        createdAt: new Date(1700000000000),
        status: 'seen',
        deliveredAt: null,
        seenAt: null,
        deletedAt: null,
        replyTo: null,
        reactions: [],
      };

      const e2eeMessage = {
        id: 'e2ee-1',
        content: JSON.stringify(validEnvelope),
        senderId: 'user-alice',
        createdAt: new Date(1700000010000),
        status: 'delivered',
        deliveredAt: null,
        seenAt: null,
        deletedAt: null,
        replyTo: {
          id: 'e2ee-reply-target',
          content: JSON.stringify(validEnvelope),
          senderId: 'user-bob',
        },
        reactions: [],
      };

      mockPrisma.message.findMany.mockResolvedValue([legacyMessage, e2eeMessage]);

      const formatted = await gateway['getFormattedMessages'](chatId, currentUserId);
      expect(formatted).toHaveLength(2);

      // Legacy item verification
      expect(formatted[0].id).toBe('legacy-1');
      expect((formatted[0] as any).text).toBe('Historical plaintext message');
      expect((formatted[0] as any).envelope).toBeUndefined();

      // E2EE item verification
      expect(formatted[1].id).toBe('e2ee-1');
      expect((formatted[1] as any).envelope).toEqual(validEnvelope);
      expect((formatted[1] as any).text).toBeUndefined();

      // E2EE reply verification: opaque content string, NO plaintext text
      expect(formatted[1].replyTo).toEqual({
        id: 'e2ee-reply-target',
        content: JSON.stringify(validEnvelope),
        sender: 'stranger',
        type: 'text',
      });
      expect((formatted[1].replyTo as any).text).toBeUndefined();
    });
  });

  describe('Security invariant: Backend NEVER decrypts E2EE messages', () => {
    it('should verify that chat.gateway does not invoke subtle.decrypt or any Web Crypto decryption helper', () => {
      // Introspect gateway prototype to confirm no decryption methods exist
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(gateway));
      const decryptMethods = proto.filter((m) => m.toLowerCase().includes('decrypt'));
      expect(decryptMethods).toEqual([]);
    });
  });

  describe('Phase 4.2 - Encrypted Media Transport & Validation', () => {
    const validImageEnvelope = {
      e2ee: true as const,
      v: 1 as const,
      type: 'image' as const,
      mime: 'image/jpeg',
      iv: 'MTIzNDU2Nzg5MDEy', // 12-byte base64
      ct: 'ZXhhbXBsZS1pbWFnZS1jaXBoZXJ0ZXh0',
    };

    const validAudioEnvelope = {
      e2ee: true as const,
      v: 1 as const,
      type: 'audio' as const,
      mime: 'audio/webm',
      iv: 'MTIzNDU2Nzg5MDEy', // 12-byte base64
      ct: 'ZXhhbXBsZS1hdWRpby1jaXBoZXJ0ZXh0',
    };

    describe('Media envelope validation (isValidE2EEMediaEnvelope)', () => {
      it('A. Valid image envelope accepted', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope(validImageEnvelope)).toBe(true);
      });

      it('B. Valid audio envelope accepted', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope(validAudioEnvelope)).toBe(true);
      });

      it('C. Invalid version rejected', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, v: 2 as any })).toBe(false);
      });

      it('D. Invalid media type rejected', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, type: 'video' as any })).toBe(false);
      });

      it('E. Invalid MIME rejected', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, mime: 'text/html' })).toBe(false);
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, mime: '' })).toBe(false);
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, mime: 'application/octet-stream' })).toBe(false);
      });

      it('F. Invalid IV rejected', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, iv: '!not-base64!' })).toBe(false);
      });

      it('G. IV with wrong length rejected', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        // 16-byte base64 instead of 12-byte
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, iv: Buffer.from(new Uint8Array(16)).toString('base64') })).toBe(false);
      });

      it('H. Empty ciphertext rejected', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, ct: '' })).toBe(false);
      });

      it('I. Invalid Base64 rejected', async () => {
        const { isValidE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, ct: '???invalid base64???' })).toBe(false);
      });

      it('J. Oversized ciphertext rejected', async () => {
        const { isValidE2EEMediaEnvelope, MAX_MEDIA_CIPHERTEXT_SIZE } = await import('./dto/e2ee-envelope.dto.js');
        const oversizedCt = 'A'.repeat(MAX_MEDIA_CIPHERTEXT_SIZE + 1);
        expect(isValidE2EEMediaEnvelope({ ...validImageEnvelope, ct: oversizedCt })).toBe(false);
      });

      it('K. Backend never attempts decryption', async () => {
        const { parseE2EEMediaEnvelope } = await import('./dto/e2ee-envelope.dto.js');
        const parsed = parseE2EEMediaEnvelope(JSON.stringify(validImageEnvelope));
        expect(parsed).toEqual(validImageEnvelope);
        expect(parsed?.ct).toBe(validImageEnvelope.ct);
      });
    });

    describe('Gateway encrypted media transport', () => {
      it('L. Stranger encrypted image accepted and persisted', async () => {
        const socket = createMockSocket('sock-stranger-img');
        const roomId = 'room-stranger-img';
        const userId = 'user-alice';
        const chatId = 'chat-stranger-img';

        mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId, chatId });

        const mockCreated = {
          id: 'msg-img-1',
          content: JSON.stringify(validImageEnvelope),
          chatId,
          senderId: userId,
          createdAt: new Date(1700000020000),
          status: 'delivered',
          replyTo: null,
        };
        mockPrisma.message.create.mockResolvedValue(mockCreated);

        await gateway.sendMessage(socket, {
          envelope: validImageEnvelope as any,
          clientId: 'client-img-1',
        });

        expect(mockPrisma.message.create).toHaveBeenCalledWith({
          data: {
            content: JSON.stringify(validImageEnvelope),
            chatId,
            senderId: userId,
            replyToId: null,
            status: 'delivered',
            deliveredAt: expect.any(Date),
          },
          include: {
            replyTo: true,
            reactions: true,
          },
        });

        expect(socket.to).toHaveBeenCalledWith(roomId);
        const emitCalls = socket.to(roomId).emit.mock.calls;
        const receiveMsgCall = emitCalls.find((call: any[]) => call[0] === 'receive_message');
        expect(receiveMsgCall).toBeDefined();
        const payload = receiveMsgCall[1];
        expect(payload.envelope).toEqual(validImageEnvelope);
        expect(payload.type).toBe('image');
        expect(payload.text).toBeUndefined();
      });

      it('M. Stranger encrypted audio accepted and broadcast', async () => {
        const socket = createMockSocket('sock-stranger-audio');
        const roomId = 'room-stranger-audio';
        const userId = 'user-bob';
        const chatId = 'chat-stranger-audio';

        mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId, chatId });

        const mockCreated = {
          id: 'msg-audio-1',
          content: JSON.stringify(validAudioEnvelope),
          chatId,
          senderId: userId,
          createdAt: new Date(1700000030000),
          status: 'delivered',
          replyTo: null,
        };
        mockPrisma.message.create.mockResolvedValue(mockCreated);

        await gateway.sendMessage(socket, {
          envelope: validAudioEnvelope as any,
          clientId: 'client-audio-1',
        });

        const emitCalls = socket.to(roomId).emit.mock.calls;
        const receiveMsgCall = emitCalls.find((call: any[]) => call[0] === 'receive_message');
        expect(receiveMsgCall).toBeDefined();
        const payload = receiveMsgCall[1];
        expect(payload.envelope).toEqual(validAudioEnvelope);
        expect(payload.type).toBe('audio');
        expect(payload.text).toBeUndefined();
      });

      it('N. Friend encrypted image accepted and persisted', async () => {
        const socket = createMockSocket('sock-friend-img');
        const roomId = 'room-friend-img';
        const senderId = 'user-alice';
        const receiverId = 'user-bob';
        const chatId = 'chat-friend-img';

        mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId: senderId, chatId });

        mockPrisma.chat.findUnique.mockResolvedValue({
          id: chatId,
          userAId: senderId,
          userBId: receiverId,
          endedAt: null,
        });

        mockPrisma.user.findUnique.mockResolvedValue({
          id: senderId,
          username: 'Alice',
        });

        const mockCreated = {
          id: 'friend-msg-img-1',
          content: JSON.stringify(validImageEnvelope),
          chatId,
          senderId,
          createdAt: new Date(1700000040000),
          status: 'sent',
          replyTo: null,
        };
        mockPrisma.message.create.mockResolvedValue(mockCreated);

        await gateway.sendFriendMessage(socket, {
          roomId,
          senderId,
          envelope: validImageEnvelope as any,
        });

        expect(mockPrisma.message.create).toHaveBeenCalledWith({
          data: {
            content: JSON.stringify(validImageEnvelope),
            chatId,
            senderId,
            replyToId: null,
            status: 'sent',
          },
          include: {
            replyTo: true,
          },
        });

        expect(gateway.server.to).toHaveBeenCalledWith(roomId);
        const serverToMock = (gateway.server.to as any)(roomId).emit;
        expect(serverToMock).toHaveBeenCalledWith('receive_friend_message', expect.objectContaining({
          id: 'friend-msg-img-1',
          envelope: validImageEnvelope,
          type: 'image',
        }));
        const friendPayload = serverToMock.mock.calls[0][1];
        expect(friendPayload.text).toBeUndefined();

        expect(mockNotifications.createNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: receiverId,
            type: 'NEW_MESSAGE',
            title: 'New message from Alice',
            body: 'New encrypted photo',
          }),
        );
      });

      it('O. Friend encrypted audio accepted and broadcast', async () => {
        const socket = createMockSocket('sock-friend-audio');
        const roomId = 'room-friend-audio';
        const senderId = 'user-alice';
        const receiverId = 'user-bob';
        const chatId = 'chat-friend-audio';

        mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId: senderId, chatId });

        mockPrisma.chat.findUnique.mockResolvedValue({
          id: chatId,
          userAId: senderId,
          userBId: receiverId,
          endedAt: null,
        });

        mockPrisma.user.findUnique.mockResolvedValue({
          id: senderId,
          username: 'Alice',
        });

        const mockCreated = {
          id: 'friend-msg-audio-1',
          content: JSON.stringify(validAudioEnvelope),
          chatId,
          senderId,
          createdAt: new Date(1700000050000),
          status: 'sent',
          replyTo: null,
        };
        mockPrisma.message.create.mockResolvedValue(mockCreated);

        await gateway.sendFriendMessage(socket, {
          roomId,
          senderId,
          envelope: validAudioEnvelope as any,
        });

        expect(mockNotifications.createNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: receiverId,
            type: 'NEW_MESSAGE',
            body: 'New encrypted voice message',
          }),
        );
      });

      it('P. Invalid encrypted media rejected', async () => {
        const socket = createMockSocket('sock-invalid-media');
        const roomId = 'room-invalid-media';
        const userId = 'user-alice';
        const chatId = 'chat-invalid-media';

        mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId, chatId });

        const malformedMediaEnvelope = {
          e2ee: true,
          v: 1,
          type: 'image',
          mime: 'application/exe',
          iv: 'invalid-iv',
          ct: '',
        };

        await gateway.sendMessage(socket, {
          envelope: malformedMediaEnvelope as any,
          clientId: 'client-err-1',
        });

        expect(mockPrisma.message.create).not.toHaveBeenCalled();
        expect(socket.emit).toHaveBeenCalledWith('message_error', {
          clientId: 'client-err-1',
          message: 'Invalid E2EE message envelope',
        });
      });

      it('Q. No plaintext text field is required for encrypted media', async () => {
        const socket = createMockSocket('sock-no-text');
        const roomId = 'room-no-text';
        const userId = 'user-alice';
        const chatId = 'chat-no-text';

        mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId, chatId });

        mockPrisma.message.create.mockResolvedValue({
          id: 'msg-no-text-1',
          content: JSON.stringify(validImageEnvelope),
          chatId,
          senderId: userId,
          createdAt: new Date(),
          status: 'delivered',
          replyTo: null,
        });

        await expect(
          gateway.sendMessage(socket, {
            envelope: validImageEnvelope as any,
          }),
        ).resolves.not.toThrow();

        expect(mockPrisma.message.create).toHaveBeenCalled();
      });

      it('R. Legacy text messages still work', async () => {
        const socket = createMockSocket('sock-legacy');
        const roomId = 'room-legacy';
        const userId = 'user-alice';
        const chatId = 'chat-legacy';

        mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId, chatId });

        mockPrisma.message.create.mockResolvedValue({
          id: 'legacy-msg-1',
          content: 'Hello legacy world',
          chatId,
          senderId: userId,
          createdAt: new Date(),
          status: 'delivered',
          replyTo: null,
        });

        await gateway.sendMessage(socket, {
          text: 'Hello legacy world',
          clientId: 'legacy-client-1',
        });

        expect(mockPrisma.message.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              content: 'Hello legacy world',
            }),
          }),
        );
      });

      it('S. Encrypted media history remains opaque on backend', async () => {
        const chatId = 'chat-history-media';
        const currentUserId = 'user-alice';

        const imageMessage = {
          id: 'hist-img-1',
          content: JSON.stringify(validImageEnvelope),
          senderId: 'user-bob',
          createdAt: new Date(1700000000000),
          status: 'seen',
          deliveredAt: null,
          seenAt: null,
          deletedAt: null,
          replyTo: {
            id: 'target-audio-msg',
            content: JSON.stringify(validAudioEnvelope),
            senderId: 'user-alice',
          },
          reactions: [],
        };

        mockPrisma.message.findMany.mockResolvedValue([imageMessage]);

        const formatted = await gateway['getFormattedMessages'](chatId, currentUserId);
        expect(formatted).toHaveLength(1);

        expect(formatted[0].id).toBe('hist-img-1');
        expect((formatted[0] as any).envelope).toEqual(validImageEnvelope);
        expect(formatted[0].type).toBe('image');
        expect((formatted[0] as any).text).toBeUndefined();

        expect(formatted[0].replyTo).toEqual({
          id: 'target-audio-msg',
          content: JSON.stringify(validAudioEnvelope),
          text: 'Encrypted audio',
          sender: 'me',
          type: 'audio',
        });
      });
    });
  });

  describe('Bug 1 & Bug 2 Fixes Verification', () => {
    it('Bug 1: should filter out blocked and reported users bidirectionally from ineligible list', async () => {
      const userId = 'user-current';
      mockPrisma.block = {
        findMany: vi.fn().mockResolvedValue([
          { blockerId: userId, blockedId: 'blocked-by-me' },
          { blockerId: 'blocked-me', blockedId: userId },
        ]),
      };
      mockPrisma.report = {
        findMany: vi.fn().mockResolvedValue([
          { reporterId: userId, reportedId: 'reported-by-me' },
          { reporterId: 'reported-me', reportedId: userId },
        ]),
      };

      const set = await gateway['getIneligibleUserIds'](userId);
      expect(set.has('blocked-by-me')).toBe(true);
      expect(set.has('blocked-me')).toBe(true);
      expect(set.has('reported-by-me')).toBe(true);
      expect(set.has('reported-me')).toBe(true);
      expect(set.has(userId)).toBe(false);
      expect(set.size).toBe(4);
    });

    it('Bug 1: areUsersIneligible returns true if either user blocked or reported the other', async () => {
      mockPrisma.block = {
        findFirst: vi.fn().mockResolvedValueOnce({ id: 'block-1' }),
      };
      mockPrisma.report = {
        findFirst: vi.fn().mockResolvedValueOnce(null),
      };

      const result1 = await gateway['areUsersIneligible']('user-a', 'user-b');
      expect(result1).toBe(true);

      mockPrisma.block.findFirst.mockResolvedValueOnce(null);
      mockPrisma.report.findFirst.mockResolvedValueOnce({ id: 'report-1' });

      const result2 = await gateway['areUsersIneligible']('user-a', 'user-b');
      expect(result2).toBe(true);

      mockPrisma.block.findFirst.mockResolvedValueOnce(null);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null);

      const result3 = await gateway['areUsersIneligible']('user-a', 'user-b');
      expect(result3).toBe(false);
    });

    it('Bug 2: handleEndChat calls leaveChat with ended', async () => {
      const socket = createMockSocket('sock-end-test');
      const leaveChatSpy = vi.spyOn(gateway as any, 'leaveChat').mockResolvedValue(undefined);

      await gateway.handleEndChat(socket);
      expect(leaveChatSpy).toHaveBeenCalledWith(socket, 'ended');
    });

    it('Bug 2: sendMessage rejects messages if chat is already ended', async () => {
      const socket = createMockSocket('sock-ended-chat');
      const roomId = 'room-ended';
      const userId = 'user-alice';
      const chatId = 'chat-ended-123';

      mockRedis.getSocketMapping.mockResolvedValue({ roomId, userId, chatId });
      mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: new Date() });

      await gateway.sendMessage(socket, {
        clientId: 'client-msg-ended',
        text: 'Hello stranger',
      });

      expect(mockPrisma.message.create).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('message_error', {
        clientId: 'client-msg-ended',
        message: 'Chat has ended',
      });
    });

    it('Multi-Tab: findStranger emits already_in_match when user already has active session', async () => {
      const socket = createMockSocket('sock-tab-2');
      const userId = 'user-multitab-1';
      const roomId = 'room-active-123';
      const chatId = 'chat-active-123';

      mockRedis.checkRateLimit = vi.fn().mockResolvedValue(true);
      vi.spyOn(gateway as any, 'getUserId').mockResolvedValue(userId);
      vi.spyOn(gateway as any, 'getUserProfile').mockResolvedValue({
        id: userId,
        username: 'MultiTabUser',
      });
      vi.spyOn(gateway as any, 'getIneligibleUserIds').mockResolvedValue(new Set());
      vi.spyOn(gateway as any, 'getSocketContext').mockResolvedValue({ userId });

      // Active match exists for this user in session state
      await gateway.setUserActiveSession(userId, {
        roomId,
        chatId,
        peerUserId: 'stranger-user-99',
        score: 85,
      });

      // Chat is not ended
      mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: null });

      await gateway.findStranger(socket, { language: 'English', interests: [], goal: 'casual-chat' });

      // Must emit exact required text: "You are already in match"
      expect(socket.emit).toHaveBeenCalledWith('already_in_match', {
        message: 'You are already in match',
      });
      // Must NOT call pushWaitingUser or create chat
      expect(mockPrisma.chat.create).not.toHaveBeenCalled();
    });

    it('Refresh / Reconnect: handleConnection restores active session to new socket', async () => {
      const socket = createMockSocket('sock-refreshed');
      const userId = 'user-refresh-1';
      const roomId = 'room-refresh-123';
      const chatId = 'chat-refresh-123';
      const peerUserId = 'user-peer-456';

      vi.spyOn(gateway as any, 'getUserId').mockResolvedValue(userId);
      vi.spyOn(gateway as any, 'recordUserOnline').mockResolvedValue(undefined);
      mockSessionTokenService.signToken = vi.fn().mockReturnValue('test-token');
      socket.join = vi.fn();

      // Active session exists
      await gateway.setUserActiveSession(userId, {
        roomId,
        chatId,
        peerUserId,
        score: 90,
      });

      mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: null });
      vi.spyOn(gateway as any, 'getFormattedMessages').mockResolvedValue([
        { id: 'm1', content: 'hello', senderId: peerUserId },
      ]);
      vi.spyOn(gateway as any, 'getUserProfile').mockResolvedValue({
        id: peerUserId,
        username: 'StrangerBob',
      });

      await gateway.handleConnection(socket);

      // Sockets joined room
      expect(socket.join).toHaveBeenCalledWith(roomId);
      // Emitted matched with peer profile and restored room
      expect(socket.emit).toHaveBeenCalledWith('matched', expect.objectContaining({
        roomId,
        chatId,
        userId,
        strangerUserId: peerUserId,
        score: 90,
      }));
      // Emitted chat history
      expect(socket.emit).toHaveBeenCalledWith('chat_history', expect.objectContaining({
        userId,
      }));
    });

    it('Disconnect Grace Period: does NOT immediately end session or emit stranger_offline on temporary disconnect', async () => {
      vi.useFakeTimers();
      const socket = createMockSocket('sock-temp-disconnect');
      const userId = 'user-grace-1';
      const roomId = 'room-grace-123';
      const chatId = 'chat-grace-123';

      mockRedis.getSocketMapping.mockResolvedValue({ roomId, chatId, userId });
      vi.spyOn(gateway as any, 'getUserId').mockResolvedValue(userId);
      mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: null });

      const leaveChatSpy = vi.spyOn(gateway as any, 'leaveChat');

      // Socket disconnects (e.g. browser refresh begins)
      await gateway.handleDisconnect(socket);

      // During the 15-second grace window, leaveChat must NOT have been called yet
      expect(leaveChatSpy).not.toHaveBeenCalled();

      // If user reconnects before 15s expires:
      const newSocket = createMockSocket('sock-reconnected');
      newSocket.join = vi.fn();
      await gateway.setUserActiveSession(userId, {
        roomId,
        chatId,
        peerUserId: 'stranger-peer-99',
        score: 75,
      });
      mockSessionTokenService.signToken = vi.fn().mockReturnValue('tok');
      vi.spyOn(gateway as any, 'getFormattedMessages').mockResolvedValue([]);
      vi.spyOn(gateway as any, 'getUserProfile').mockResolvedValue({ id: 'stranger-peer-99' });

      await gateway.handleConnection(newSocket);

      // Advance time past 15 seconds
      await vi.advanceTimersByTimeAsync(20000);

      // leaveChat must STILL not have been called because reconnection cancelled the grace timer!
      expect(leaveChatSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('End Chat / Skip Stranger: releases active session lock so user can search again', async () => {
      const socket = createMockSocket('sock-end-lock');
      const userId = 'user-end-lock-1';
      const roomId = 'room-lock-123';
      const chatId = 'chat-lock-123';

      await gateway.setUserActiveSession(userId, {
        roomId,
        chatId,
        peerUserId: 'stranger-lock-99',
        score: 80,
      });

      mockRedis.getSocketMapping.mockResolvedValue({ roomId, chatId, userId });
      vi.spyOn(gateway as any, 'getUserId').mockResolvedValue(userId);
      mockPrisma.chat.findUnique.mockResolvedValue({ endedAt: null });
      mockPrisma.chat.update.mockResolvedValue({ id: chatId, endedAt: new Date() });

      // Explicit end chat
      await gateway.handleEndChat(socket);

      // Active session must now be null
      const activeSessionAfterEnd = await gateway.getUserActiveSession(userId);
      expect(activeSessionAfterEnd).toBeNull();
    });
  });
});


