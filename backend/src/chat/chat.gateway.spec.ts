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
