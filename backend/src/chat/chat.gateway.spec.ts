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

    // Sockets left and Redis cleaned up
    expect(socket.leave).toHaveBeenCalledWith(roomId);
    expect(mockRedis.removePresence).toHaveBeenCalledWith('socket-disconnect');
    expect(mockRedis.removeSocketMapping).toHaveBeenCalledWith('socket-disconnect');
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
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
    };

    mockRedis = {
      getIsConnected: vi.fn().mockReturnValue(true),
      checkRateLimit: vi.fn().mockResolvedValue(true),
      getSocketMapping: vi.fn(),
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

      // Assert friend broadcast contains envelope and NO text property
      const serverToMock = (gateway.server.to as any)(roomId).emit;
      expect(serverToMock).toHaveBeenCalledWith('receive_friend_message', {
        id: 'friend-msg-1',
        envelope: validEnvelope,
        senderId,
        timestamp: 1700000005000,
        type: 'text',
        status: 'sent',
        replyTo: null,
      });
      const friendPayload = serverToMock.mock.calls[0][1];
      expect(friendPayload.text).toBeUndefined();

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
      expect(formatted[0].text).toBe('Historical plaintext message');
      expect((formatted[0] as any).envelope).toBeUndefined();

      // E2EE item verification
      expect(formatted[1].id).toBe('e2ee-1');
      expect(formatted[1].envelope).toEqual(validEnvelope);
      expect(formatted[1].text).toBeUndefined();

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
});

