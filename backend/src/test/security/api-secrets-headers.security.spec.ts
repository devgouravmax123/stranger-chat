import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';

describe('Security Test Suite: Secrets, Headers, Error Disclosure & AI Controls (Phase 5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  const testUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  }, 30000);

  afterAll(async () => {
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      }).catch(() => null);
    }
    await app.close();
  }, 15000);

  // ==========================================
  // SECRET EXPOSURE IN API RESPONSES
  // ==========================================

  describe('Secret & Credential Leakage Protection', () => {
    it('SEC-SEC-01: API responses must never leak server environment secrets or connection strings', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_leak_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const endpoints = [
        `/users/${user.id}/profile`,
        `/notifications/${user.id}`,
        `/friends/${user.id}`,
      ];

      for (const ep of endpoints) {
        const res = await request(app.getHttpServer()).get(ep);
        const text = JSON.stringify(res.body);

        // Verify secrets are never exposed
        if (process.env.GEMINI_API_KEY) {
          expect(text).not.toContain(process.env.GEMINI_API_KEY);
        }
        if (process.env.DATABASE_URL) {
          // Don't leak raw database connection string
          expect(text).not.toContain('postgresql://');
        }
        if (process.env.REDIS_URL) {
          expect(text).not.toContain('redis://');
        }
      }
    });
  });

  // ==========================================
  // ERROR INFORMATION DISCLOSURE
  // ==========================================

  describe('Error Response Information Disclosure', () => {
    it('SEC-ERR-01: error responses must not expose stack traces, DB credentials or internal filepaths', async () => {
      const res = await request(app.getHttpServer()).get('/users/invalid-uuid-404-check/profile');

      expect(res.status).toBe(404);
      const resText = JSON.stringify(res.body);

      // Must not contain stack trace indicators or local directory paths
      expect(resText).not.toContain('    at ');
      expect(resText).not.toContain('node_modules');
      expect(resText).not.toContain('C:\\Users');
      expect(resText).not.toContain('/home/');
    });
  });

  // ==========================================
  // GEMINI / AI ENDPOINT SECURITY CONTROLS
  // ==========================================

  describe('Gemini / AI Endpoint Security Controls', () => {
    it('SEC-AI-01: should reject generic or anonymous user IDs (me, anonymous, empty)', async () => {
      const payloads = [
        { userId: 'anonymous' },
        { userId: 'me' },
        { userId: '' },
        { userId: '   ' },
      ];

      for (const p of payloads) {
        const res = await request(app.getHttpServer())
          .post('/ai/conversation-suggestions')
          .send({
            ...p,
            conversationId: 'test_conv',
            messages: [
              { sender: 'user', text: 'Hello' },
              { sender: 'stranger', text: 'Hi there' },
              { sender: 'user', text: 'How are you?' },
            ],
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('valid user session is required');
      }
    });

    it('SEC-AI-02: should require minimum 3 text messages to prevent empty/spam generation', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_ai_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: user.id,
          conversationId: 'test_conv',
          messages: [
            { sender: 'user', text: 'Hi' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toEqual([]);
      expect(res.body.message).toContain('Chat a little more');
    });
  });

  // ==========================================
  // REDIS RATE LIMIT ISOLATION
  // ==========================================

  describe('Redis Rate Limit State Isolation', () => {
    it('SEC-REDIS-01: rate limiting for User A must not impact User B', async () => {
      const keyA = `sec_user_a_${Date.now()}`;
      const keyB = `sec_user_b_${Date.now()}`;

      // User A consumes all rate limit tokens (max 2 per 5s)
      const a1 = await redis.checkRateLimit(keyA, 'test_action', 2, 5);
      const a2 = await redis.checkRateLimit(keyA, 'test_action', 2, 5);
      const a3 = await redis.checkRateLimit(keyA, 'test_action', 2, 5); // Should be blocked

      expect(a1).toBe(true);
      expect(a2).toBe(true);
      expect(a3).toBe(false);

      // User B should still be allowed
      const b1 = await redis.checkRateLimit(keyB, 'test_action', 2, 5);
      expect(b1).toBe(true);

      await redis.del(`rate:${keyA}:test_action`);
      await redis.del(`rate:${keyB}:test_action`);
    });
  });

  // ==========================================
  // CORS & HTTP SECURITY HEADERS & RATE LIMIT
  // ==========================================

  describe('HTTP Security Headers & Rate Limiting (Remediated)', () => {
    it('SEC-HDR-01: X-Powered-By header must be completely absent from HTTP responses', async () => {
      const res = await request(app.getHttpServer()).get('/users/00000000-0000-0000-0000-000000000000/profile');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('SEC-HDR-02: Standard security headers must be enforced on all responses', async () => {
      const res = await request(app.getHttpServer()).get('/users/00000000-0000-0000-0000-000000000000/profile');
      const headers = res.headers;

      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('SEC-RATE-01: Global REST rate limiter prevents IP spoofing via X-Forwarded-For when trust proxy is disabled', async () => {
      const httpServer = app.getHttpServer();

      // Check current remaining quota for this direct connection
      const initial = await request(httpServer)
        .get('/users/00000000-0000-0000-0000-000000000000/profile')
        .set('X-Forwarded-For', '10.0.0.1');

      const remainingStr = initial.headers['x-ratelimit-remaining'];
      const remaining = remainingStr ? parseInt(remainingStr, 10) : 119;

      // Exhaust remaining allowance with differing spoofed X-Forwarded-For headers
      const allowedReqs = [];
      for (let i = 0; i < remaining; i++) {
        allowedReqs.push(
          request(httpServer)
            .get('/users/00000000-0000-0000-0000-000000000000/profile')
            .set('X-Forwarded-For', `10.0.1.${i + 1}`),
        );
      }
      const allowedResponses = await Promise.all(allowedReqs);
      for (const res of allowedResponses) {
        expect(res.status).not.toBe(429);
      }

      // The next request attempting yet another spoofed X-Forwarded-For MUST STILL be throttled
      // because trust proxy is disabled and the direct connection address is tracked
      const throttledRes = await request(httpServer)
        .get('/users/00000000-0000-0000-0000-000000000000/profile')
        .set('X-Forwarded-For', '203.0.113.199');

      expect(throttledRes.status).toBe(429);
      expect(throttledRes.body.message).toContain('Too many requests');
    });

    it('SEC-RATE-02: Global REST rate limiter respects Express trust proxy when configured', async () => {
      // Enable trust proxy dynamically on the Express instance
      const expressApp = app.getHttpAdapter().getInstance();
      expressApp.set('trust proxy', true);

      const httpServer = app.getHttpServer();
      const clientIp = '198.51.100.42';

      // Send 120 rapid requests from clientIp through trusted proxy
      const allowedReqs = [];
      for (let i = 0; i < 120; i++) {
        allowedReqs.push(
          request(httpServer)
            .get('/users/00000000-0000-0000-0000-000000000000/profile')
            .set('X-Forwarded-For', clientIp),
        );
      }
      const allowedResponses = await Promise.all(allowedReqs);
      for (const res of allowedResponses) {
        expect(res.status).not.toBe(429);
      }

      // 121st request from same clientIp through proxy is throttled
      const throttledRes = await request(httpServer)
        .get('/users/00000000-0000-0000-0000-000000000000/profile')
        .set('X-Forwarded-For', clientIp);

      expect(throttledRes.status).toBe(429);

      // A different client IP through the proxy is NOT throttled (isolated)
      const diffClientRes = await request(httpServer)
        .get('/users/00000000-0000-0000-0000-000000000000/profile')
        .set('X-Forwarded-For', '198.51.100.43');

      expect(diffClientRes.status).toBe(404);

      // Revert trust proxy to disabled
      expressApp.set('trust proxy', false);
    });
  });
});
