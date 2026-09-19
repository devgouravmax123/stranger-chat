import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { FriendsService } from '../../friends/friends.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Security Test Suite: Authentication & Authorization / IDOR (Phase 5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let friendsService: FriendsService;
  let sessionTokenService: SessionTokenService;

  const testUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    friendsService = app.get(FriendsService);
    sessionTokenService = app.get(SessionTokenService);
  }, 30000);

  afterAll(async () => {
    if (testUserIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { userId: { in: testUserIds } },
      }).catch(() => null);

      await prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { senderId: { in: testUserIds } },
            { receiverId: { in: testUserIds } },
          ],
        },
      }).catch(() => null);

      await prisma.friendship.deleteMany({
        where: {
          OR: [
            { userAId: { in: testUserIds } },
            { userBId: { in: testUserIds } },
          ],
        },
      }).catch(() => null);

      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      }).catch(() => null);
    }

    await app.close();
  }, 15000);

  // ==========================================
  // IDOR & ACCESS CONTROL: FRIEND SYSTEM
  // ==========================================

  describe('Friend Request IDOR & Access Control', () => {
    it('SEC-AUTH-01: should reject cross-user friend request acceptance (User C cannot accept User B request)', async () => {
      // User A sends friend request to User B
      const userA = await prisma.user.create({
        data: { username: `sec_a_${Date.now()}_${Math.random().toString(36).slice(7)}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_b_${Date.now()}_${Math.random().toString(36).slice(7)}` },
      });
      const userC = await prisma.user.create({
        data: { username: `sec_c_${Date.now()}_${Math.random().toString(36).slice(7)}` },
      });
      testUserIds.push(userA.id, userB.id, userC.id);

      const reqResult = await friendsService.sendFriendRequest(userA.id, userB.id);

      // User C attempts to accept the request directed to User B
      const res = await request(app.getHttpServer())
        .put(`/friends/request/${reqResult.requestId}/accept`)
        .send({ userId: userC.id });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('You cannot accept this friend request');

      // Verify request is still PENDING in database
      const dbReq = await prisma.friendRequest.findUnique({
        where: { id: reqResult.requestId },
      });
      expect(dbReq?.status).toBe('PENDING');
    });

    it('SEC-AUTH-02: should reject cross-user friend request rejection (User C cannot reject User B request)', async () => {
      const userA = await prisma.user.create({
        data: { username: `sec_rej_a_${Date.now()}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_rej_b_${Date.now()}` },
      });
      const userC = await prisma.user.create({
        data: { username: `sec_rej_c_${Date.now()}` },
      });
      testUserIds.push(userA.id, userB.id, userC.id);

      const reqResult = await friendsService.sendFriendRequest(userA.id, userB.id);

      // User C attempts to reject
      const res = await request(app.getHttpServer())
        .put(`/friends/request/${reqResult.requestId}/reject`)
        .send({ userId: userC.id });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('You cannot reject this friend request');
    });

    it('SEC-AUTH-03: should prevent self-friend request submission', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_self_${Date.now()}` },
      });
      testUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .post('/friends/request')
        .send({ senderId: user.id, receiverId: user.id });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('You cannot send a friend request to yourself');
    });
  });

  // ==========================================
  // IDOR & ACCESS CONTROL: NOTIFICATIONS
  // ==========================================

  describe('Notification IDOR & Ownership Isolation', () => {
    it('SEC-AUTH-04: should isolate notification read status so User A cannot alter User B notifications', async () => {
      const userA = await prisma.user.create({
        data: { username: `sec_notif_a_${Date.now()}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_notif_b_${Date.now()}` },
      });
      testUserIds.push(userA.id, userB.id);

      // Create unread notification for User B
      const notifB = await prisma.notification.create({
        data: {
          userId: userB.id,
          type: 'FRIEND_REQUEST',
          title: 'Private Alert',
          body: 'Sensitive B data',
          isRead: false,
        },
      });

      // User A attempts to mark User B's notification as read
      const res = await request(app.getHttpServer())
        .put(`/notifications/${notifB.id}/read`)
        .send({ userId: userA.id });

      expect(res.status).toBe(200);
      expect(res.body.affected).toBe(0); // 0 records updated because ownership check failed

      // Verify notification for User B remains unread in database
      const freshNotif = await prisma.notification.findUnique({
        where: { id: notifB.id },
      });
      expect(freshNotif?.isRead).toBe(false);
    });

    it('SEC-AUTH-05: bulk read operation must not affect notifications of other users', async () => {
      const userA = await prisma.user.create({
        data: { username: `sec_bulk_a_${Date.now()}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_bulk_b_${Date.now()}` },
      });
      testUserIds.push(userA.id, userB.id);

      const notifB = await prisma.notification.create({
        data: {
          userId: userB.id,
          type: 'FRIEND_REQUEST',
          title: 'Target Notification',
          body: 'Should not be marked',
          isRead: false,
        },
      });

      // User A sends bulk read for User B's notification ID
      const res = await request(app.getHttpServer())
        .put(`/notifications/user/${userA.id}/read-bulk`)
        .send({ notificationIds: [notifB.id] });

      expect(res.status).toBe(200);
      expect(res.body.affected).toBe(0);

      const check = await prisma.notification.findUnique({
        where: { id: notifB.id },
      });
      expect(check?.isRead).toBe(false);
    });
  });

  // ==========================================
  // IDENTITY & ACCESS AUDIT: USERS CONTROLLER
  // ==========================================

  describe('User Account & Profile Endpoints Access Audit', () => {
    it('SEC-AUTH-06: returns 404 when querying non-existent user profile', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer()).get(`/users/${fakeId}/profile`);
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('User not found');
    });

    it('SEC-AUTH-07A: should reject profile update when session token is missing (401)', async () => {
      const targetUser = await prisma.user.create({
        data: { username: `sec_profile_${Date.now()}`, age: 25 },
      });
      testUserIds.push(targetUser.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${targetUser.id}/profile`)
        .send({
          username: `updated_${Date.now()}`,
          age: 25,
          gender: 'male',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Session token is required');
    });

    it('SEC-AUTH-07B: should reject profile update when session token is invalid (401)', async () => {
      const targetUser = await prisma.user.create({
        data: { username: `sec_inv_${Date.now()}`, age: 25 },
      });
      testUserIds.push(targetUser.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${targetUser.id}/profile`)
        .set('Authorization', 'Bearer invalid.bogus.token')
        .send({
          username: `updated_${Date.now()}`,
          age: 25,
          gender: 'male',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid or expired session token');
    });

    it('SEC-AUTH-07C: should reject profile update when session token is expired (401)', async () => {
      const targetUser = await prisma.user.create({
        data: { username: `sec_exp_${Date.now()}`, age: 25 },
      });
      testUserIds.push(targetUser.id);

      // Create an expired token (-1000ms expiration)
      const expiredToken = sessionTokenService.signToken(targetUser.id, -1000);

      const res = await request(app.getHttpServer())
        .put(`/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({
          username: `updated_${Date.now()}`,
          age: 25,
          gender: 'male',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid or expired session token');
    });

    it('SEC-AUTH-07D: should reject profile update when User A token attempts to modify User B profile (403 IDOR)', async () => {
      const userA = await prisma.user.create({
        data: { username: `sec_idor_a_${Date.now()}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_idor_b_${Date.now()}` },
      });
      testUserIds.push(userA.id, userB.id);

      const tokenA = sessionTokenService.signToken(userA.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${userB.id}/profile`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          username: `hijacked_${Date.now()}`,
          age: 25,
          gender: 'female',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('cannot access or modify resources belonging to another user');
    });

    it('SEC-AUTH-07E: should accept profile update when valid session token for target user is provided (200)', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_valid_${Date.now()}`, age: 20 },
      });
      testUserIds.push(user.id);

      const validToken = sessionTokenService.signToken(user.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${user.id}/profile`)
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          username: `valid_upd_${Date.now()}`,
          age: 22,
          gender: 'other',
        });

      expect(res.status).toBe(200);
      expect(res.body.age).toBe(22);
    });

    it('SEC-AUTH-07F: should reject preferences update when User A tries to modify User B preferences (403 IDOR)', async () => {
      const userA = await prisma.user.create({
        data: { username: `sec_pref_a_${Date.now()}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_pref_b_${Date.now()}` },
      });
      testUserIds.push(userA.id, userB.id);

      const tokenA = sessionTokenService.signToken(userA.id);

      const res = await request(app.getHttpServer())
        .put(`/users/${userB.id}/preferences`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          interests: ['coding'],
          language: 'English',
          goal: 'casual-chat',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('cannot access or modify resources belonging to another user');
    });

    it('SEC-AUTH-07G: should reject account deletion when User A tries to delete User B account (403 IDOR)', async () => {
      const userA = await prisma.user.create({
        data: { username: `sec_del_a_${Date.now()}` },
      });
      const userB = await prisma.user.create({
        data: { username: `sec_del_b_${Date.now()}` },
      });
      testUserIds.push(userA.id, userB.id);

      const tokenA = sessionTokenService.signToken(userA.id);

      const res = await request(app.getHttpServer())
        .delete(`/users/${userB.id}/account`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('cannot access or modify resources belonging to another user');

      // Verify User B is still intact in DB
      const checkUserB = await prisma.user.findUnique({ where: { id: userB.id } });
      expect(checkUserB).not.toBeNull();
    });

    it('SEC-AUTH-07H: should allow user to delete own account with valid token (200)', async () => {
      const user = await prisma.user.create({
        data: { username: `sec_selfdel_${Date.now()}` },
      });
      const token = sessionTokenService.signToken(user.id);

      const res = await request(app.getHttpServer())
        .delete(`/users/${user.id}/account`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const checkUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(checkUser).toBeNull();
    });
  });
});
