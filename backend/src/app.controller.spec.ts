import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisService } from './redis/redis.service.js';

describe('AppController (API)', () => {
  let app: INestApplication;
  let redisService: { getIsConnected: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    redisService = {
      getIsConnected: vi.fn().mockReturnValue(true),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: RedisService, useValue: redisService },
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

  describe('GET /health', () => {
    it('should return 200 with ok status and redisConnected: true', async () => {
      const res = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(res.body).toEqual({
        status: 'ok',
        message: 'Stranger Chat backend is running',
        redisConnected: true,
      });
    });

    it('should return 200 with redisConnected: false when Redis is disconnected', async () => {
      redisService.getIsConnected.mockReturnValue(false);

      const res = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(res.body).toEqual({
        status: 'ok',
        message: 'Stranger Chat backend is running',
        redisConnected: false,
      });
    });
  });

  describe('POST /messages', () => {
    it('should return 400 when text is sent because CreateMessageDto has no validation decorator and forbidNonWhitelisted is active', async () => {
      const res = await request(app.getHttpServer())
        .post('/messages')
        .send({ text: 'Hello Chirp!' });

      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(['property text should not exist']);
    });

    it('should return 400 when empty body is sent because instantiated DTO property text lacks validator decorator under forbidNonWhitelisted', async () => {
      const res = await request(app.getHttpServer())
        .post('/messages')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(['property text should not exist']);
    });
  });
});