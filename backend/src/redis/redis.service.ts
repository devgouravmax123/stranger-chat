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

  /**
   * Basic String Key Operations
   */
  async get(key: string): Promise<string | null> {
    if (!this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) return;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {}
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.del(key);
    } catch (err) {}
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (err) {
      return false;
    }
  }

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
    if (!this.isConnected) return true; // Fail open if Redis is offline
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
    if (!this.isConnected) return;
    const key = `match:${roomId}`;
    await this.set(key, JSON.stringify(matchData), 86400);
  }

  async getMatchState(roomId: string): Promise<any | null> {
    if (!this.isConnected) return null;
    const key = `match:${roomId}`;
    const raw = await this.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async removeMatchState(roomId: string): Promise<void> {
    if (!this.isConnected) return;
    const key = `match:${roomId}`;
    await this.del(key);
  }
}
