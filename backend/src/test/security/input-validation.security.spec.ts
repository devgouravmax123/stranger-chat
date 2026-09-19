import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Security Test Suite: Input Validation & Injection Defenses (Phase 5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessionTokenService: SessionTokenService;

  const testUserIds: string[] = [];

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

    prisma = app.get(PrismaService);
    sessionTokenService = app.get(SessionTokenService);
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
  // SQL INJECTION DEFENSE (PRISMA PARAMETERIZATION)
  // ==========================================

  describe('SQL Injection Payload Resistance', () => {
    it('SEC-INP-01: should safely treat SQL injection syntax in username as literal string data', async () => {
      const sqliPayload = "admin' OR '1'='1' --";
      const user = await prisma.user.create({
        data: { username: `u_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${user.id}/profile`)
        .set('Authorization', `Bearer ${sessionTokenService.signToken(user.id)}`)
        .send({
          username: sqliPayload,
          age: 25,
          gender: 'male',
        });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe(sqliPayload);

      // Verify literal storage in database without syntax exploitation
      const fetched = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(fetched?.username).toBe(sqliPayload);
    });

    it('SEC-INP-02: should treat SQL DROP TABLE syntax in search query safely', async () => {
      const user = await prisma.user.create({
        data: { username: `u_sqli_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .get('/friends/search')
        .query({ userId: user.id, q: "'; DROP TABLE \"User\"; --" });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Verify User table is intact and still accessible
      const tableCheck = await prisma.user.findFirst();
      expect(tableCheck).toBeDefined();
    });
  });

  // ==========================================
  // XSS PAYLOAD HANDLING
  // ==========================================

  describe('Cross-Site Scripting (XSS) Input Handling', () => {
    it('SEC-INP-03: should store script tags harmlessly as literal characters', async () => {
      const xssPayload = '<script>alert("XSS")</script><img src=x onerror=alert(1)>';
      const user = await prisma.user.create({
        data: { username: `u_xss_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${user.id}/profile`)
        .set('Authorization', `Bearer ${sessionTokenService.signToken(user.id)}`)
        .send({
          username: xssPayload,
          age: 25,
          gender: 'male',
        });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe(xssPayload);
    });
  });

  // ==========================================
  // VALIDATION PIPE: MASS ASSIGNMENT & FORBID NON-WHITELISTED
  // ==========================================

  describe('Mass Assignment & Schema Strictness', () => {
    it('SEC-INP-04: should reject requests containing non-whitelisted / injected fields (forbidNonWhitelisted)', async () => {
      const user = await prisma.user.create({
        data: { username: `u_strict_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${user.id}/profile`)
        .set('Authorization', `Bearer ${sessionTokenService.signToken(user.id)}`)
        .send({
          username: 'valid_user',
          age: 25,
          gender: 'male',
          isAdmin: true, // Non-whitelisted field
          role: 'SUPERADMIN', // Malicious privilege escalation attempt
        });

      expect(res.status).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.some((m: string) => m.includes('should not exist'))).toBe(true);
    });

    it('SEC-INP-05: should reject invalid data types (number instead of string username)', async () => {
      const user = await prisma.user.create({
        data: { username: `u_type_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${user.id}/profile`)
        .set('Authorization', `Bearer ${sessionTokenService.signToken(user.id)}`)
        .send({
          username: 12345,
          age: 25,
          gender: 'male',
        });

      expect(res.status).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
    });
  });

  // ==========================================
  // BOUNDARY & OVERFLOW INPUTS
  // ==========================================

  describe('Boundary Conditions & Excessively Long Inputs', () => {
    it('SEC-INP-06: should handle oversized inputs without backend crashes', async () => {
      const user = await prisma.user.create({
        data: { username: `u_over_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const longString = 'A'.repeat(5000);
      const res = await request(app.getHttpServer())
        .put(`/users/${user.id}/profile`)
        .set('Authorization', `Bearer ${sessionTokenService.signToken(user.id)}`)
        .send({
          username: longString,
          age: 25,
          gender: 'male',
        });

      // Either accepted as long string or rejected by validation, but NOT crashing (500)
      expect(res.status).not.toBe(500);
    });

    it('SEC-INP-07: should safely return 404 for malformed/non-existent UUIDs in route params', async () => {
      const malformedId = 'not-a-valid-uuid-format-$$$';
      const res = await request(app.getHttpServer()).get(`/users/${malformedId}/profile`);
      expect(res.status).toBe(404);
    });
  });
});
