import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private isConnected = false;

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false, // Prevents queuing commands when Redis is offline
      retryStrategy(times) {
        return Math.min(times * 500, 5000);
      },
      lazyConnect: false,
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      this.logger.log('=================================');
      this.logger.log('REDIS CONNECTED SUCCESSFULLY');
      this.logger.log('=================================');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      if (this.isConnected) {
        this.logger.warn(`Redis connection lost: ${err.message}`);
      }
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {}
      this.logger.log('Redis client disconnected gracefully.');
    }
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  private fallbackMemoryMap = new Map<string, { value: string; expiresAt?: number }>();
  private fallbackUserSockets = new Map<string, Set<string>>();

  /**
   * Basic String Key Operations with in-memory resilience
   */
  async get(key: string): Promise<string | null> {
    if (!this.isConnected) {
      const item = this.fallbackMemoryMap.get(key);
      if (!item) return null;
      if (item.expiresAt && Date.now() > item.expiresAt) {
        this.fallbackMemoryMap.delete(key);
        return null;
      }
      return item.value;
    }
    try {
      return await this.client.get(key);
    } catch (err) {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) {
      this.fallbackMemoryMap.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      });
      return;
    }
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {}
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected) {
      this.fallbackMemoryMap.delete(key);
      return;
    }
    try {
      await this.client.del(key);
    } catch (err) {}
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) {
      const item = this.fallbackMemoryMap.get(key);
      if (!item) return false;
      if (item.expiresAt && Date.now() > item.expiresAt) {
        this.fallbackMemoryMap.delete(key);
        return false;
      }
      return true;
    }
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (err) {
      return false;
    }
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.isConnected) {
      const now = Date.now();
      const existing = this.fallbackMemoryMap.get(key);
      let count = 1;
      let expiresAt: number | undefined = ttlSeconds ? now + ttlSeconds * 1000 : undefined;
      if (existing) {
        if (existing.expiresAt && now > existing.expiresAt) {
          count = 1;
        } else {
          count = (parseInt(existing.value, 10) || 0) + 1;
          expiresAt = existing.expiresAt || expiresAt;
        }
      }
      this.fallbackMemoryMap.set(key, { value: String(count), expiresAt });
      return count;
    }
    try {
      const current = await this.client.incr(key);
      if (current === 1 && ttlSeconds) {
        await this.client.expire(key, ttlSeconds);
      }
      return current;
    } catch (err) {
      const now = Date.now();
      const existing = this.fallbackMemoryMap.get(key);
      const count = (existing ? parseInt(existing.value, 10) || 0 : 0) + 1;
      this.fallbackMemoryMap.set(key, {
        value: String(count),
        expiresAt: ttlSeconds ? now + ttlSeconds * 1000 : undefined,
      });
      return count;
    }
  }

  async decr(key: string): Promise<number> {
    if (!this.isConnected) {
      const existing = this.fallbackMemoryMap.get(key);
      if (!existing) return 0;
      const count = Math.max(0, (parseInt(existing.value, 10) || 0) - 1);
      this.fallbackMemoryMap.set(key, { ...existing, value: String(count) });
      return count;
    }
    try {
      return await this.client.decr(key);
    } catch (err) {
      return 0;
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.isConnected) {
      const item = this.fallbackMemoryMap.get(key);
      if (!item || !item.expiresAt) return -1;
      const rem = Math.max(0, Math.ceil((item.expiresAt - Date.now()) / 1000));
      return rem;
    }
    try {
      return await this.client.ttl(key);
    } catch (err) {
      return -1;
    }
  }

  private fallbackRateLimitMap = new Map<string, { count: number; expiresAt: number }>();

  /**
   * Rate Limiting Counter (Sliding Window / Fixed Window)
   * returns true if under limit, false if limit exceeded.
   */
  async checkRateLimit(
    identifier: string,
    event: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    if (!this.isConnected) {
      const key = `ratelimit:${event}:${identifier}`;
      const now = Date.now();
      const record = this.fallbackRateLimitMap.get(key);
      if (!record || now > record.expiresAt) {
        this.fallbackRateLimitMap.set(key, {
          count: 1,
          expiresAt: now + windowSeconds * 1000,
        });
        return true;
      }
      record.count += 1;
      return record.count <= limit;
    }

    try {
      const key = `ratelimit:${event}:${identifier}`;
      const current = await this.client.incr(key);
      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }
      return current <= limit;
    } catch (err) {
      return true; // Fail open on error
    }
  }

  /**
   * Matchmaking Waiting Queue Operations (Redis List)
   */
  async pushWaitingUser(userPayload: {
    socketId: string;
    userId: string;
    preferences: any;
    createdAt: number;
  }): Promise<void> {
    if (!this.isConnected) return;
    try {
      const payloadString = JSON.stringify(userPayload);
      await this.client.rpush('matchmaking:waiting', payloadString);
    } catch (err) {}
  }

  async popWaitingUser(): Promise<{
    socketId: string;
    userId: string;
    preferences: any;
    createdAt: number;
  } | null> {
    if (!this.isConnected) return null;
    try {
      const rawPayload = await this.client.lpop('matchmaking:waiting');
      if (!rawPayload) return null;
      return JSON.parse(rawPayload);
    } catch (err) {
      return null;
    }
  }

  async getWaitingQueueLength(): Promise<number> {
    if (!this.isConnected) return 0;
    try {
      return await this.client.llen('matchmaking:waiting');
    } catch {
      return 0;
    }
  }

  async removeWaitingUserBySocketId(socketId: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      const items = await this.client.lrange('matchmaking:waiting', 0, -1);
      for (const item of items) {
        try {
          const parsed = JSON.parse(item);
          if (parsed.socketId === socketId) {
            await this.client.lrem('matchmaking:waiting', 0, item);
          }
        } catch {}
      }
    } catch (err) {}
  }

  /**
   * User Presence State
   */
  async setPresence(
    socketId: string,
    state: 'online' | 'searching' | 'chatting',
    ttlSeconds = 300,
  ): Promise<void> {
    if (!this.isConnected) return;
    const key = `presence:user:${socketId}`;
    await this.set(key, state, ttlSeconds);
  }

  async getPresence(socketId: string): Promise<string | null> {
    if (!this.isConnected) return null;
    const key = `presence:user:${socketId}`;
    return await this.get(key);
  }

  async removePresence(socketId: string): Promise<void> {
    if (!this.isConnected) return;
    const key = `presence:user:${socketId}`;
    await this.del(key);
  }

  /**
   * User Multi-Socket Presence Tracking
   */
  async addUserSocketPresence(userId: string, socketId: string): Promise<number> {
    const setKey = `presence:sockets:${userId}`;
    const userKey = `presence:user:${userId}`;
    if (!this.isConnected) {
      const sockets = this.fallbackUserSockets.get(userId) || new Set<string>();
      sockets.add(socketId);
      this.fallbackUserSockets.set(userId, sockets);
      return sockets.size;
    }
    try {
      await this.client.sadd(setKey, socketId);
      await this.client.expire(setKey, 86400);
      await this.set(userKey, 'online', 86400);
      return await this.client.scard(setKey);
    } catch {
      return 1;
    }
  }

  async removeUserSocketPresence(userId: string, socketId: string): Promise<number> {
    const setKey = `presence:sockets:${userId}`;
    const userKey = `presence:user:${userId}`;
    if (!this.isConnected) {
      const sockets = this.fallbackUserSockets.get(userId);
      if (sockets) {
        sockets.delete(socketId);
        if (sockets.size === 0) this.fallbackUserSockets.delete(userId);
        return sockets.size;
      }
      return 0;
    }
    try {
      await this.client.srem(setKey, socketId);
      const remaining = await this.client.scard(setKey);
      if (remaining === 0) {
        await this.del(userKey);
        await this.del(setKey);
      }
      return remaining;
    } catch {
      return 0;
    }
  }

  async isUserOnline(userId: string): Promise<boolean> {
    if (!this.isConnected) {
      const sockets = this.fallbackUserSockets.get(userId);
      return !!(sockets && sockets.size > 0);
    }
    try {
      const count = await this.client.scard(`presence:sockets:${userId}`);
      if (count > 0) return true;
      const val = await this.get(`presence:user:${userId}`);
      return val === 'online';
    } catch {
      return false;
    }
  }

  async areUsersOnline(userIds: string[]): Promise<Set<string>> {
    const onlineSet = new Set<string>();
    if (!userIds || userIds.length === 0) return onlineSet;

    if (!this.isConnected) {
      for (const id of userIds) {
        const sockets = this.fallbackUserSockets.get(id);
        if (sockets && sockets.size > 0) onlineSet.add(id);
      }
      return onlineSet;
    }

    try {
      const pipeline = this.client.pipeline();
      for (const id of userIds) {
        pipeline.scard(`presence:sockets:${id}`);
      }
      const results = await pipeline.exec();
      if (results) {
        results.forEach(([err, count], idx) => {
          if (!err && typeof count === 'number' && count > 0) {
            onlineSet.add(userIds[idx]);
          }
        });
      }
      return onlineSet;
    } catch {
      return onlineSet;
    }
  }

  async cleanupUserRedisState(userId: string): Promise<void> {
    const socketsKey = `presence:sockets:${userId}`;

    // 1. Gather all socket IDs associated with this user to clean their socket:map entries
    let userSocketIds: string[] = [];
    if (!this.isConnected) {
      const fallbackSockets = this.fallbackUserSockets.get(userId);
      if (fallbackSockets) {
        userSocketIds = Array.from(fallbackSockets);
        this.fallbackUserSockets.delete(userId);
      }
    } else {
      try {
        userSocketIds = await this.client.smembers(socketsKey);
      } catch {}
    }

    // 2. Remove socket mapping keys for these sockets
    for (const socketId of userSocketIds) {
      await this.del(`socket:map:${socketId}`);
      await this.del(`presence:user:${socketId}`);
    }

    // 3. Delete direct user keys
    const directKeys = [
      `presence:user:${userId}`,
      socketsKey,
      `ai:cooldown:${userId}`,
      `ai:inflight:${userId}`,
      `user:match:${userId}`,
    ];
    for (const k of directKeys) {
      await this.del(k);
    }

    // 4. Scan and delete any ai:daily-usage:${userId}:* keys
    if (this.isConnected) {
      try {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.client.scan(
            cursor,
            'MATCH',
            `ai:daily-usage:${userId}:*`,
            'COUNT',
            50,
          );
          cursor = nextCursor;
          if (keys && keys.length > 0) {
            for (const k of keys) {
              await this.del(k);
            }
          }
        } while (cursor !== '0');
      } catch (scanErr) {
        // Fallback: also try deleting today's and yesterday's keys directly
        const todayDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
        }).format(new Date());
        await this.del(`ai:daily-usage:${userId}:${todayDate}`);
      }

      // 5. Remove user from matchmaking queue
      try {
        const items = await this.client.lrange('matchmaking:waiting', 0, -1);
        for (const item of items) {
          try {
            const parsed = JSON.parse(item);
            if (parsed.userId === userId) {
              await this.client.lrem('matchmaking:waiting', 0, item);
            }
          } catch {}
        }
      } catch {}
    } else {
      // Offline fallback map cleanup
      for (const [key] of Array.from(this.fallbackMemoryMap.entries())) {
        if (key.startsWith(`ai:daily-usage:${userId}:`) || key.startsWith(`ratelimit:`) && key.endsWith(`:${userId}`)) {
          this.fallbackMemoryMap.delete(key);
        }
      }
    }
  }

  /**
   * Active Room & Socket Mappings
   */
  async setSocketMapping(socketId: string, data: {
    userId?: string;
    roomId?: string;
    chatId?: string;
  }): Promise<void> {
    if (!this.isConnected) return;
    const key = `socket:map:${socketId}`;
    try {
      const existingRaw = await this.get(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const updated = { ...existing, ...data };
      if (data.roomId === undefined) delete updated.roomId;
      if (data.chatId === undefined) delete updated.chatId;
      await this.set(key, JSON.stringify(updated), 86400); // 24 hours TTL
    } catch (err) {}
  }

  async getSocketMapping(socketId: string): Promise<{
    userId?: string;
    roomId?: string;
    chatId?: string;
  } | null> {
    if (!this.isConnected) return null;
    const key = `socket:map:${socketId}`;
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async removeSocketMapping(socketId: string): Promise<void> {
    if (!this.isConnected) return;
    const key = `socket:map:${socketId}`;
    await this.del(key);
  }

  /**
   * Active Match State
   */
  async setMatchState(roomId: string, matchData: {
    userAId: string;
    userASocketId: string;
    userBId: string;
    userBSocketId: string;
    chatId: string;
    createdAt: number;
  }): Promise<void> {
    const key = `match:${roomId}`;
    await this.set(key, JSON.stringify(matchData), 86400);
  }

  async getMatchState(roomId: string): Promise<any | null> {
    const key = `match:${roomId}`;
    const raw = await this.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async removeMatchState(roomId: string): Promise<void> {
    const key = `match:${roomId}`;
    await this.del(key);
  }

  /**
   * User Active Match State (One-active-match enforcement)
   */
  async setUserActiveMatch(userId: string, data: {
    roomId: string;
    chatId: string;
    peerUserId: string;
    score: number;
    createdAt?: number;
  }): Promise<void> {
    const key = `user:match:${userId}`;
    const payload = {
      ...data,
      createdAt: data.createdAt ?? Date.now(),
    };
    await this.set(key, JSON.stringify(payload), 86400);
  }

  async getUserActiveMatch(userId: string): Promise<{
    roomId: string;
    chatId: string;
    peerUserId: string;
    score: number;
    createdAt: number;
  } | null> {
    const key = `user:match:${userId}`;
    const raw = await this.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async removeUserActiveMatch(userId: string): Promise<void> {
    const key = `user:match:${userId}`;
    await this.del(key);
  }
}
