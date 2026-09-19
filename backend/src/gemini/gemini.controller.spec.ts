import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { GeminiController } from './gemini.controller.js';
import { GeminiService } from './gemini.service.js';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../prisma.service.js';

describe('GeminiController (API)', () => {
  let app: INestApplication;
  let mockGeminiService: {
    generateConversationSuggestions: ReturnType<typeof vi.fn>;
  };
  let mockRedisService: {
    exists: ReturnType<typeof vi.fn>;
    ttl: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    decr: ReturnType<typeof vi.fn>;
  };
  let mockPrismaService: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    mockGeminiService = {
      generateConversationSuggestions: vi.fn(),
    };

    mockRedisService = {
      exists: vi.fn().mockResolvedValue(0),
      ttl: vi.fn().mockResolvedValue(-1),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      decr: vi.fn().mockResolvedValue(0),
    };

    mockPrismaService = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'usr_valid' }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [GeminiController],
      providers: [
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
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
  });

  afterEach(async () => {
    await app.close();
  });

  const validMessages = [
    { sender: 'usr_alice', text: 'Hey, how are you doing today?' },
    { sender: 'usr_bob', text: 'I am doing great! Learning TypeScript right now.' },
    { sender: 'usr_alice', text: 'Nice! Have you tried NestJS and React?' },
  ];

  describe('POST /ai/conversation-suggestions', () => {
    it('should return 200 with 3 suggestions on valid request', async () => {
      const generatedSuggestions = [
        'What backend frameworks have you used?',
        'Do you prefer Next.js or Vite?',
        'Are you building any side projects?',
      ];
      mockGeminiService.generateConversationSuggestions.mockResolvedValue(generatedSuggestions);

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(200);

      expect(res.body).toEqual({
        suggestions: generatedSuggestions,
        cached: false,
        cooldownSeconds: 10,
      });
      expect(mockGeminiService.generateConversationSuggestions).toHaveBeenCalled();
    });

    it('should return 200 with friendly message when messages is empty', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: [],
        })
        .expect(200);

      expect(res.body).toEqual({
        suggestions: [],
        message: 'Start chatting first, then I can suggest topics based on your conversation.',
      });
      expect(mockGeminiService.generateConversationSuggestions).not.toHaveBeenCalled();
    });

    it('should return 200 with friendly message when fewer than 3 meaningful messages', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: [
            { sender: 'usr_alice', text: 'Hey' },
            { sender: 'usr_bob', text: 'Hi' },
          ],
        })
        .expect(200);

      expect(res.body).toEqual({
        suggestions: [],
        message: "Chat a little more and I'll find some ideas for you.",
      });
      expect(mockGeminiService.generateConversationSuggestions).not.toHaveBeenCalled();
    });

    it('should return 200 with cached suggestions on cache hit without calling Gemini', async () => {
      const cachedSuggestions = ['Topic A', 'Topic B', 'Topic C'];
      mockRedisService.get.mockImplementation(async (key: string) => {
        if (key.startsWith('ai:suggestions:')) {
          return JSON.stringify(cachedSuggestions);
        }
        return null;
      });

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(200);

      expect(res.body).toEqual({
        suggestions: cachedSuggestions,
        cached: true,
        cooldownSeconds: 10,
      });
      expect(mockGeminiService.generateConversationSuggestions).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when userId is missing or empty', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          messages: validMessages,
        })
        .expect(400);

      expect(res.body.error).toContain('A valid user session is required');
    });

    it('should return 400 Bad Request when userId is placeholder "me" or "anonymous"', async () => {
      const resMe = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'me',
          messages: validMessages,
        })
        .expect(400);

      expect(resMe.body.error).toContain('A valid user session is required');

      const resAnon = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'anonymous',
          messages: validMessages,
        })
        .expect(400);

      expect(resAnon.body.error).toContain('A valid user session is required');
    });

    it('should return 400 Bad Request when payload violates DTO validation', async () => {
      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          messages: 'not-an-array',
        })
        .expect(400);

      expect(res.body.message).toContain('messages must be an array');
    });

    it('should return 429 Too Many Requests when user cooldown is active', async () => {
      mockRedisService.exists.mockResolvedValue(1); // active cooldown
      mockRedisService.ttl.mockResolvedValue(7);

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(429);

      expect(res.body.error).toContain('Please wait before requesting new suggestions');
      expect(res.body.cooldownRemaining).toBe(7);
      expect(mockGeminiService.generateConversationSuggestions).not.toHaveBeenCalled();
    });

    it('should return 429 Too Many Requests when daily limit is reached', async () => {
      mockRedisService.get.mockImplementation(async (key: string) => {
        if (key.startsWith('ai:daily-usage:')) {
          return '5'; // default limit is 5
        }
        return null;
      });

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(429);

      expect(res.body.error).toContain("You've reached your daily limit");
      expect(mockGeminiService.generateConversationSuggestions).not.toHaveBeenCalled();
    });

    it('should return 429 Too Many Requests when concurrency admission gate is saturated (>4)', async () => {
      mockRedisService.incr.mockImplementation(async (key: string) => {
        if (key === 'ai:global:inflight') {
          return 5; // > 4
        }
        return 1;
      });

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(429);

      expect(res.body.error).toContain('AI suggestions are busy right now');
      expect(mockRedisService.decr).toHaveBeenCalledWith('ai:global:inflight');
      expect(mockGeminiService.generateConversationSuggestions).not.toHaveBeenCalled();
    });

    it('should map RATE_LIMIT service error to 429 Too Many Requests', async () => {
      mockGeminiService.generateConversationSuggestions.mockRejectedValue(new Error('RATE_LIMIT'));

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(429);

      expect(res.body.error).toContain('AI suggestions are busy right now');
    });

    it('should map TIMEOUT service error to 504 Gateway Timeout', async () => {
      mockGeminiService.generateConversationSuggestions.mockRejectedValue(new Error('TIMEOUT'));

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(504);

      expect(res.body.error).toContain('Request timed out');
    });

    it('should map MALFORMED_RESPONSE service error to 422 Unprocessable Entity', async () => {
      mockGeminiService.generateConversationSuggestions.mockRejectedValue(
        new Error('MALFORMED_RESPONSE'),
      );

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(422);

      expect(res.body.error).toContain('Invalid AI response');
    });

    it('should map unexpected service errors to 503 Service Unavailable', async () => {
      mockGeminiService.generateConversationSuggestions.mockRejectedValue(
        new Error('Network failure'),
      );

      const res = await request(app.getHttpServer())
        .post('/ai/conversation-suggestions')
        .send({
          userId: 'usr_valid',
          conversationId: 'conv_123',
          messages: validMessages,
        })
        .expect(503);

      expect(res.body.error).toContain("Couldn't generate suggestions right now");
    });
  });
});
