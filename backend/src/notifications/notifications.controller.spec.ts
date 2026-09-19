import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsController (API)', () => {
  let app: INestApplication;
  let mockNotificationsService: {
    getNotifications: ReturnType<typeof vi.fn>;
    getUnreadCount: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    markNotificationsAsRead: ReturnType<typeof vi.fn>;
    markAllAsRead: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockNotificationsService = {
      getNotifications: vi.fn(),
      getUnreadCount: vi.fn(),
      markAsRead: vi.fn(),
      markNotificationsAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
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

  // ==========================================
  // GET /notifications/:userId
  // ==========================================
  describe('GET /notifications/:userId', () => {
    it('should return 200 and list of notifications for user', async () => {
      const mockNotifications = [
        {
          id: 'notif_1',
          userId: 'usr_1',
          type: 'FRIEND_REQUEST',
          title: 'New Friend Request',
          message: 'Alice sent you a friend request',
          isRead: false,
          createdAt: new Date().toISOString(),
        },
      ];
      mockNotificationsService.getNotifications.mockResolvedValue(mockNotifications);

      const res = await request(app.getHttpServer())
        .get('/notifications/usr_1')
        .expect(200);

      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith('usr_1');
      expect(res.body).toEqual(mockNotifications);
    });

    it('should return 200 with empty array when user has no notifications', async () => {
      mockNotificationsService.getNotifications.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/notifications/usr_empty')
        .expect(200);

      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith('usr_empty');
      expect(res.body).toEqual([]);
    });
  });

  // ==========================================
  // GET /notifications/:userId/unread-count
  // ==========================================
  describe('GET /notifications/:userId/unread-count', () => {
    it('should return 200 with unread notification count', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(5);

      const res = await request(app.getHttpServer())
        .get('/notifications/usr_1/unread-count')
        .expect(200);

      expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledWith('usr_1');
      expect(res.body).toEqual({ count: 5 });
    });

    it('should return 200 with 0 count when no unread notifications', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(0);

      const res = await request(app.getHttpServer())
        .get('/notifications/usr_1/unread-count')
        .expect(200);

      expect(res.body).toEqual({ count: 0 });
    });
  });

  // ==========================================
  // PUT /notifications/:id/read
  // ==========================================
  describe('PUT /notifications/:id/read', () => {
    it('should return 200 and mark single notification as read', async () => {
      const updatedNotif = {
        id: 'notif_1',
        userId: 'usr_1',
        isRead: true,
      };
      mockNotificationsService.markAsRead.mockResolvedValue(updatedNotif);

      const res = await request(app.getHttpServer())
        .put('/notifications/notif_1/read')
        .send({ userId: 'usr_1' })
        .expect(200);

      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith('notif_1', 'usr_1');
      expect(res.body).toEqual(updatedNotif);
    });

    it('should return 404 Not Found when notification is not found or unauthorized', async () => {
      mockNotificationsService.markAsRead.mockRejectedValue(
        new NotFoundException('Notification not found'),
      );

      const res = await request(app.getHttpServer())
        .put('/notifications/notif_missing/read')
        .send({ userId: 'usr_1' })
        .expect(404);

      expect(res.body.message).toBe('Notification not found');
    });
  });

  // ==========================================
  // PUT /notifications/user/:userId/read-bulk
  // ==========================================
  describe('PUT /notifications/user/:userId/read-bulk', () => {
    it('should return 200 and mark array of notifications as read', async () => {
      mockNotificationsService.markNotificationsAsRead.mockResolvedValue({ count: 3 });

      const res = await request(app.getHttpServer())
        .put('/notifications/user/usr_1/read-bulk')
        .send({ notificationIds: ['notif_1', 'notif_2', 'notif_3'] })
        .expect(200);

      expect(mockNotificationsService.markNotificationsAsRead).toHaveBeenCalledWith(
        'usr_1',
        ['notif_1', 'notif_2', 'notif_3'],
      );
      expect(res.body).toEqual({ count: 3 });
    });

    it('should handle empty or omitted notificationIds array gracefully', async () => {
      mockNotificationsService.markNotificationsAsRead.mockResolvedValue({ count: 0 });

      const res = await request(app.getHttpServer())
        .put('/notifications/user/usr_1/read-bulk')
        .send({})
        .expect(200);

      expect(mockNotificationsService.markNotificationsAsRead).toHaveBeenCalledWith('usr_1', []);
      expect(res.body).toEqual({ count: 0 });
    });
  });

  // ==========================================
  // PUT /notifications/user/:userId/read-all
  // ==========================================
  describe('PUT /notifications/user/:userId/read-all', () => {
    it('should return 200 and mark all user notifications as read', async () => {
      mockNotificationsService.markAllAsRead.mockResolvedValue({ count: 12 });

      const res = await request(app.getHttpServer())
        .put('/notifications/user/usr_1/read-all')
        .expect(200);

      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith('usr_1');
      expect(res.body).toEqual({ count: 12 });
    });
  });
});
