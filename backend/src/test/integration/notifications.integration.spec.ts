import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { SessionTokenService } from '../../auth/session-token.service.js';

describe('Notifications Integration (PostgreSQL + REST + Socket.IO Realtime)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notificationsService: NotificationsService;
  let sessionTokenService: SessionTokenService;
  let serverPort: number;

  const testUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    serverPort = typeof address === 'string' ? 3001 : address.port;

    prisma = app.get(PrismaService);
    notificationsService = app.get(NotificationsService);
    sessionTokenService = app.get(SessionTokenService);
  }, 30000);

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 200));

    if (testUserIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { userId: { in: testUserIds } },
      }).catch(() => null);

      await prisma.user.deleteMany({
        where: { id: { in: testUserIds } },
      }).catch(() => null);
    }

    await app.close();
  }, 15000);

  function createClient(userId: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = io(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: { userId, token: sessionTokenService.signToken(userId) },
      });

      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error(`Socket connection timed out for user ${userId}`));
      }, 5000);

      socket.on('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it('should create notification in PostgreSQL and emit realtime new_notification to user socket', async () => {
    const user = await prisma.user.create({
      data: { username: `notif_user_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    testUserIds.push(user.id);

    const client = await createClient(user.id);

    try {
      const notifReceivedPromise = new Promise<any>((resolve) => {
        client.once('new_notification', resolve);
      });

      const created = await notificationsService.createNotification({
        userId: user.id,
        type: 'SYSTEM',
        title: 'Welcome to Chirp',
        body: 'Welcome to real-time notifications!',
      });

      expect(created.id).toBeDefined();

      // 1. Verify in database
      const dbNotif = await prisma.notification.findUnique({
        where: { id: created.id },
      });
      expect(dbNotif).toBeDefined();
      expect(dbNotif?.title).toBe('Welcome to Chirp');
      expect(dbNotif?.isRead).toBe(false);

      // 2. Verify realtime socket reception
      const realtimeData = await notifReceivedPromise;
      expect(realtimeData.id).toBe(created.id);
      expect(realtimeData.title).toBe('Welcome to Chirp');
    } finally {
      client.disconnect();
    }
  });

  it('should query unread-count, mark single notification as read, and emit notifications_read event', async () => {
    const user = await prisma.user.create({
      data: { username: `notif_u2_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    testUserIds.push(user.id);

    const client = await createClient(user.id);

    try {
      const notif = await notificationsService.createNotification({
        userId: user.id,
        type: 'SYSTEM',
        title: 'Unread Test',
        body: 'Testing unread count and read emission',
      });

      // 1. Check unread count via REST
      const countRes = await request(app.getHttpServer())
        .get(`/notifications/${user.id}/unread-count`)
        .expect(200);

      expect(countRes.body.count).toBeGreaterThanOrEqual(1);

      // 2. Mark as read and check realtime event
      const readEventPromise = new Promise<any>((resolve) => {
        client.once('notifications_read', resolve);
      });

      const markRes = await request(app.getHttpServer())
        .put(`/notifications/${notif.id}/read`)
        .send({ userId: user.id })
        .expect(200);

      expect(markRes.body.success).toBe(true);

      // 3. Verify realtime event emitted to socket
      const readEvent = await readEventPromise;
      expect(readEvent).toBeDefined();
      expect(readEvent.readIds).toContain(notif.id);

      // 4. Verify DB unread count is now 0
      const dbCount = await prisma.notification.count({
        where: { userId: user.id, isRead: false },
      });
      expect(dbCount).toBe(0);
    } finally {
      client.disconnect();
    }
  });

  it('should mark notifications in bulk and mark all as read via REST', async () => {
    const user = await prisma.user.create({
      data: { username: `notif_u3_${Date.now()}_${Math.random().toString(36).substring(7)}` },
    });
    testUserIds.push(user.id);

    // Create 3 notifications
    const n1 = await notificationsService.createNotification({
      userId: user.id,
      type: 'SYSTEM',
      title: 'Bulk 1',
      body: 'Item 1',
    });
    const n2 = await notificationsService.createNotification({
      userId: user.id,
      type: 'SYSTEM',
      title: 'Bulk 2',
      body: 'Item 2',
    });
    const n3 = await notificationsService.createNotification({
      userId: user.id,
      type: 'SYSTEM',
      title: 'Bulk 3',
      body: 'Item 3',
    });

    const initialCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });
    expect(initialCount).toBe(3);

    // 1. Bulk read n1 and n2
    const bulkRes = await request(app.getHttpServer())
      .put(`/notifications/user/${user.id}/read-bulk`)
      .send({ notificationIds: [n1.id, n2.id] })
      .expect(200);

    expect(bulkRes.body.success).toBe(true);
    expect(bulkRes.body.count).toBe(1);

    const countAfterBulk = await prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });
    expect(countAfterBulk).toBe(1);

    // 2. Mark all as read
    const allRes = await request(app.getHttpServer())
      .put(`/notifications/user/${user.id}/read-all`)
      .expect(200);

    expect(allRes.body.count).toBe(0);

    const countAfterAll = await prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });
    expect(countAfterAll).toBe(0);
  });
});
