import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisService } from './redis.service.js';

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(() => {
    service = new RedisService();
  });

  describe('In-memory Fallback Mode (when Redis offline / disconnected)', () => {
    it('should report isConnected as false initially', () => {
      expect(service.getIsConnected()).toBe(false);
    });

    it('should set, get, and delete values in fallback memory map', async () => {
      await service.set('test-key', 'hello');
      expect(await service.get('test-key')).toBe('hello');
      expect(await service.exists('test-key')).toBe(true);

      await service.del('test-key');
      expect(await service.get('test-key')).toBeNull();
      expect(await service.exists('test-key')).toBe(false);
    });

    it('should expire keys with TTL in fallback memory map', async () => {
      // Set key with 1 second TTL
      await service.set('temp-key', 'ephemeral', 1);
      expect(await service.get('temp-key')).toBe('ephemeral');

      // Manipulate time or verify TTL estimation
      const remainingTtl = await service.ttl('temp-key');
      expect(remainingTtl).toBeGreaterThanOrEqual(0);
      expect(remainingTtl).toBeLessThanOrEqual(1);

      // Verify ttl of non-existent key returns -1
      expect(await service.ttl('no-such-key')).toBe(-1);
    });

    it('should handle incr and decr in fallback mode', async () => {
      const c1 = await service.incr('counter');
      expect(c1).toBe(1);

      const c2 = await service.incr('counter');
      expect(c2).toBe(2);

      const c3 = await service.decr('counter');
      expect(c3).toBe(1);

      const c4 = await service.decr('counter');
      expect(c4).toBe(0);

      const c5 = await service.decr('counter');
      expect(c5).toBe(0); // decr does not go below 0
    });

    it('should rate limit requests accurately in fallback mode', async () => {
      const id = 'user-123';
      const event = 'message';
      const limit = 3;
      const windowSeconds = 10;

      expect(await service.checkRateLimit(id, event, limit, windowSeconds)).toBe(true); // 1
      expect(await service.checkRateLimit(id, event, limit, windowSeconds)).toBe(true); // 2
      expect(await service.checkRateLimit(id, event, limit, windowSeconds)).toBe(true); // 3
      expect(await service.checkRateLimit(id, event, limit, windowSeconds)).toBe(false); // 4 (exceeded)
    });

    it('should track user socket presences and online status in fallback mode', async () => {
      expect(await service.isUserOnline('user-A')).toBe(false);

      const s1 = await service.addUserSocketPresence('user-A', 'socket-1');
      expect(s1).toBe(1);
      expect(await service.isUserOnline('user-A')).toBe(true);

      const s2 = await service.addUserSocketPresence('user-A', 'socket-2');
      expect(s2).toBe(2);

      const r1 = await service.removeUserSocketPresence('user-A', 'socket-1');
      expect(r1).toBe(1);
      expect(await service.isUserOnline('user-A')).toBe(true);

      const r2 = await service.removeUserSocketPresence('user-A', 'socket-2');
      expect(r2).toBe(0);
      expect(await service.isUserOnline('user-A')).toBe(false);
    });

    it('should batch-check online users in fallback mode', async () => {
      await service.addUserSocketPresence('user-X', 'sock-x');
      const onlineSet = await service.areUsersOnline(['user-X', 'user-Y']);
      expect(onlineSet.has('user-X')).toBe(true);
      expect(onlineSet.has('user-Y')).toBe(false);
    });
  });

  describe('Connected Mode (Mocked Redis Client)', () => {
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        exists: vi.fn(),
        incr: vi.fn(),
        decr: vi.fn(),
        expire: vi.fn(),
        ttl: vi.fn(),
        rpush: vi.fn(),
        lpop: vi.fn(),
        llen: vi.fn(),
        lrange: vi.fn(),
        lrem: vi.fn(),
        sadd: vi.fn(),
        srem: vi.fn(),
        scard: vi.fn(),
        smembers: vi.fn(),
        scan: vi.fn(),
        quit: vi.fn(),
        pipeline: vi.fn(),
      };

      // Inject mock client and set connected to true
      (service as any).client = mockClient;
      (service as any).isConnected = true;
    });

    it('should delegate get and set to Redis client', async () => {
      mockClient.get.mockResolvedValue('val');
      const res = await service.get('key');
      expect(mockClient.get).toHaveBeenCalledWith('key');
      expect(res).toBe('val');

      await service.set('key', 'val', 60);
      expect(mockClient.set).toHaveBeenCalledWith('key', 'val', 'EX', 60);
    });

    it('should handle matchmaking waiting queue push, pop, and len', async () => {
      const payload = {
        socketId: 'sock-1',
        userId: 'u-1',
        preferences: { language: 'English' },
        createdAt: Date.now(),
      };

      await service.pushWaitingUser(payload);
      expect(mockClient.rpush).toHaveBeenCalledWith(
        'matchmaking:waiting',
        JSON.stringify(payload),
      );

      mockClient.lpop.mockResolvedValue(JSON.stringify(payload));
      const popped = await service.popWaitingUser();
      expect(popped).toEqual(payload);

      mockClient.llen.mockResolvedValue(5);
      const len = await service.getWaitingQueueLength();
      expect(len).toBe(5);
    });

    it('should remove user from waiting queue by socketId', async () => {
      const item1 = JSON.stringify({ socketId: 'sock-A', userId: 'u-A' });
      const item2 = JSON.stringify({ socketId: 'sock-B', userId: 'u-B' });
      mockClient.lrange.mockResolvedValue([item1, item2]);

      await service.removeWaitingUserBySocketId('sock-A');

      expect(mockClient.lrem).toHaveBeenCalledWith('matchmaking:waiting', 0, item1);
      expect(mockClient.lrem).not.toHaveBeenCalledWith('matchmaking:waiting', 0, item2);
    });

    it('should check rate limits using Redis incr and expire', async () => {
      mockClient.incr.mockResolvedValue(1);
      const allowed = await service.checkRateLimit('user-1', 'send-chat', 5, 60);
      expect(mockClient.incr).toHaveBeenCalledWith('ratelimit:send-chat:user-1');
      expect(mockClient.expire).toHaveBeenCalledWith('ratelimit:send-chat:user-1', 60);
      expect(allowed).toBe(true);

      mockClient.incr.mockResolvedValue(6);
      const blocked = await service.checkRateLimit('user-1', 'send-chat', 5, 60);
      expect(blocked).toBe(false);
    });

    it('should set, get, and remove user active match in Redis', async () => {
      const matchData = {
        roomId: 'room-123',
        chatId: 'chat-456',
        peerUserId: 'peer-789',
        score: 95,
        createdAt: 1000000,
      };

      await service.setUserActiveMatch('user-1', matchData);
      expect(mockClient.set).toHaveBeenCalledWith(
        'user:match:user-1',
        JSON.stringify(matchData),
        'EX',
        86400,
      );

      mockClient.get.mockResolvedValue(JSON.stringify(matchData));
      const res = await service.getUserActiveMatch('user-1');
      expect(res).toEqual(matchData);

      await service.removeUserActiveMatch('user-1');
      expect(mockClient.del).toHaveBeenCalledWith('user:match:user-1');
    });

    it('should clean up all user Redis state including sockets, mappings, and daily AI keys', async () => {
      mockClient.smembers.mockResolvedValue(['sock-user-1', 'sock-user-2']);
      mockClient.scan.mockResolvedValue(['0', ['ai:daily-usage:user-1:2026-09-25']]);
      const queueItem = JSON.stringify({ socketId: 'sock-user-1', userId: 'user-1' });
      const otherQueueItem = JSON.stringify({ socketId: 'sock-other', userId: 'other-user' });
      mockClient.lrange.mockResolvedValue([queueItem, otherQueueItem]);

      await service.cleanupUserRedisState('user-1');

      // Verify socket mappings deleted
      expect(mockClient.del).toHaveBeenCalledWith('socket:map:sock-user-1');
      expect(mockClient.del).toHaveBeenCalledWith('socket:map:sock-user-2');

      // Verify direct presence and match keys deleted
      expect(mockClient.del).toHaveBeenCalledWith('presence:user:user-1');
      expect(mockClient.del).toHaveBeenCalledWith('presence:sockets:user-1');
      expect(mockClient.del).toHaveBeenCalledWith('ai:cooldown:user-1');
      expect(mockClient.del).toHaveBeenCalledWith('ai:inflight:user-1');
      expect(mockClient.del).toHaveBeenCalledWith('user:match:user-1');

      // Verify daily AI usage keys scanned and deleted
      expect(mockClient.del).toHaveBeenCalledWith('ai:daily-usage:user-1:2026-09-25');

      // Verify user removed from queue
      expect(mockClient.lrem).toHaveBeenCalledWith('matchmaking:waiting', 0, queueItem);
      expect(mockClient.lrem).not.toHaveBeenCalledWith('matchmaking:waiting', 0, otherQueueItem);
    });

    it('should gracefully clean up onModuleDestroy', async () => {
      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalled();
    });
  });
});
