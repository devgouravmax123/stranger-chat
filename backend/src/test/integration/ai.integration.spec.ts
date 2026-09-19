import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { GeminiService } from '../../gemini/gemini.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { PrismaService } from '../../prisma.service.js';

describe('AI Suggestions Integration (HTTP + Controller + Service + Redis + DB)', () => {
  let app: INestApplication;
  let geminiService: GeminiService;
  let redisService: RedisService;
  let prisma: PrismaService;

  let testUserId: string;
  let stubGenerateContent: ReturnType<typeof vi.fn>;
  const createdRedisKeys: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    geminiService = app.get(GeminiService);
    redisService = app.get(RedisService);
    prisma = app.get(PrismaService);

    // Create persistent test user in DB for identity check
    const user = await prisma.user.create({
      data: { username: `ai_int_user_${Date.now()}` },
    });
    testUserId = user.id;

    // Stub ONLY the external Google GenAI client to prevent real network requests
    stubGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify(['AI Topic Alpha', 'AI Topic Beta', 'AI Topic Gamma']),
    });

    (geminiService as any).client = {
      models: {
        generateContent: stubGenerateContent,
      },
    };
  }, 30000);

  afterAll(async () => {
    if (testUserId) {
      await prisma.user.delete({
        where: { id: testUserId },
      }).catch(() => null);
    }

    // Clean up test Redis keys
    for (const k of createdRedisKeys) {
      await redisService.del(k).catch(() => null);
    }

    await app.close();
  }, 15000);

  const sampleMessages = [
    { sender: 'user_1', text: 'Hey there!' },
    { sender: 'user_2', text: 'Hello! How are you doing?' },
    { sender: 'user_1', text: 'I am learning AI and full-stack integration testing!' },
  ];

  it('should process request, invoke Gemini service, return suggestions, and cache in Redis', async () => {
    const conversationId = `conv_test_${Date.now()}`;

    const res = await request(app.getHttpServer())
      .post('/ai/conversation-suggestions')
      .send({
        userId: testUserId,
        conversationId,
        messages: sampleMessages,
      })
      .expect(200);

    expect(res.body.suggestions).toEqual(['AI Topic Alpha', 'AI Topic Beta', 'AI Topic Gamma']);
    expect(res.body.cached).toBe(false);
    expect(res.body.cooldownSeconds).toBe(10);
    expect(stubGenerateContent).toHaveBeenCalled();

    // Verify cooldown key exists in real Redis
    const cooldownKey = `ai:cooldown:${testUserId}`;
    createdRedisKeys.push(cooldownKey);
    const hasCooldown = await redisService.exists(cooldownKey);
    expect(hasCooldown).toBe(true);
  });

  it('should enforce 10-second UX cooldown on immediate second request', async () => {
    // Cooldown is still active from previous test
    const res = await request(app.getHttpServer())
      .post('/ai/conversation-suggestions')
      .send({
        userId: testUserId,
        conversationId: `conv_different_${Date.now()}`,
        messages: [
          ...sampleMessages,
          { sender: 'user_2', text: 'What do you think about Redis integration?' },
        ],
      })
      .expect(429);

    expect(res.body.error).toContain('Please wait before requesting new suggestions');
    expect(res.body.cooldownRemaining).toBeGreaterThan(0);
  });

  it('should serve cached suggestions from Redis without calling upstream Gemini', async () => {
    // Clear cooldown to allow request
    const cooldownKey = `ai:cooldown:${testUserId}`;
    await redisService.del(cooldownKey);

    const conversationId = `conv_cache_${Date.now()}`;
    stubGenerateContent.mockClear();

    // 1. First call populates cache
    await request(app.getHttpServer())
      .post('/ai/conversation-suggestions')
      .send({
        userId: testUserId,
        conversationId,
        messages: sampleMessages,
      })
      .expect(200);

    expect(stubGenerateContent).toHaveBeenCalledTimes(1);

    // 2. Clear cooldown so cache read is reached
    await redisService.del(cooldownKey);

    // 3. Repeated identical call must hit Redis cache
    const cacheRes = await request(app.getHttpServer())
      .post('/ai/conversation-suggestions')
      .send({
        userId: testUserId,
        conversationId,
        messages: sampleMessages,
      })
      .expect(200);

    expect(cacheRes.body.cached).toBe(true);
    expect(cacheRes.body.suggestions).toEqual([
      'AI Topic Alpha',
      'AI Topic Beta',
      'AI Topic Gamma',
    ]);
    // Should NOT have called upstream again
    expect(stubGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('should enforce daily quota in Redis when user limit is reached', async () => {
    const todayDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    }).format(new Date());
    const dailyKey = `ai:daily-usage:${testUserId}:${todayDate}`;
    createdRedisKeys.push(dailyKey);

    // Set daily usage in Redis to limit (5)
    await redisService.set(dailyKey, '5', 86400);

    // Clear cooldown
    await redisService.del(`ai:cooldown:${testUserId}`);

    const res = await request(app.getHttpServer())
      .post('/ai/conversation-suggestions')
      .send({
        userId: testUserId,
        conversationId: `conv_daily_${Date.now()}`,
        messages: sampleMessages,
      })
      .expect(429);

    expect(res.body.error).toContain('reached your daily limit');
  });

  it('should properly map upstream service errors (TIMEOUT -> 504, MALFORMED -> 422)', async () => {
    // Reset daily and cooldown for test
    const todayDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    }).format(new Date());
    await redisService.del(`ai:daily-usage:${testUserId}:${todayDate}`);
    await redisService.del(`ai:cooldown:${testUserId}`);

    // Test TIMEOUT mapping
    stubGenerateContent.mockRejectedValueOnce(new Error('GEMINI_TIMEOUT'));

    const timeoutRes = await request(app.getHttpServer())
      .post('/ai/conversation-suggestions')
      .send({
        userId: testUserId,
        conversationId: `conv_err_1_${Date.now()}`,
        messages: sampleMessages,
      })
      .expect(504);

    expect(timeoutRes.body.error).toContain('Request timed out');

    // Test MALFORMED_RESPONSE mapping
    stubGenerateContent.mockResolvedValueOnce({
      text: 'Invalid non-json output',
    });

    const malformedRes = await request(app.getHttpServer())
      .post('/ai/conversation-suggestions')
      .send({
        userId: testUserId,
        conversationId: `conv_err_2_${Date.now()}`,
        messages: sampleMessages,
      })
      .expect(422);

    expect(malformedRes.body.error).toContain('Invalid AI response');
  });
});
