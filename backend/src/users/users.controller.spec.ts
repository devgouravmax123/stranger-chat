import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { SessionTokenService } from '../auth/session-token.service.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';

describe('UsersController (API)', () => {
  let app: INestApplication;
  let mockUsersService: {
    updateProfile: ReturnType<typeof vi.fn>;
    updatePreferences: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
    deleteAccount: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockUsersService = {
      updateProfile: vi.fn(),
      updatePreferences: vi.fn(),
      getProfile: vi.fn(),
      deleteAccount: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        SessionTokenService,
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: 'usr_me_123' };
          return true;
        },
      })
      .compile();

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
  // PUT /users/:userId/profile
  // ==========================================
  describe('PUT /users/:userId/profile', () => {
    const validProfilePayload = {
      username: 'chirp_master',
      age: 24,
      gender: 'non-binary',
      avatar: 'https://chirp.app/avatar.png',
      interests: ['coding', 'music'],
      language: 'English',
      goal: 'Make friends',
    };

    it('should return 200 and updated profile on valid request', async () => {
      const mockResult = {
        id: 'usr_123',
        ...validProfilePayload,
        createdAt: new Date().toISOString(),
      };
      mockUsersService.updateProfile.mockResolvedValue(mockResult);

      const res = await request(app.getHttpServer())
        .put('/users/usr_123/profile')
        .send(validProfilePayload)
        .expect(200);

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('usr_123', validProfilePayload);
      expect(res.body).toEqual(mockResult);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .put('/users/usr_123/profile')
        .send({ age: 24 })
        .expect(400);

      expect(res.body.message).toContain('username must be longer than or equal to 3 characters');
      expect(res.body.message).toContain('gender should not be empty');
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when username is shorter than 3 characters', async () => {
      const res = await request(app.getHttpServer())
        .put('/users/usr_123/profile')
        .send({
          ...validProfilePayload,
          username: 'ab',
        })
        .expect(400);

      expect(res.body.message).toContain('username must be longer than or equal to 3 characters');
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when age is under minimum boundary (13)', async () => {
      const res = await request(app.getHttpServer())
        .put('/users/usr_123/profile')
        .send({
          ...validProfilePayload,
          age: 12,
        })
        .expect(400);

      expect(res.body.message).toContain('age must not be less than 13');
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when age exceeds maximum boundary (100)', async () => {
      const res = await request(app.getHttpServer())
        .put('/users/usr_123/profile')
        .send({
          ...validProfilePayload,
          age: 101,
        })
        .expect(400);

      expect(res.body.message).toContain('age must not be greater than 100');
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 400 when non-whitelisted property is provided', async () => {
      const res = await request(app.getHttpServer())
        .put('/users/usr_123/profile')
        .send({
          ...validProfilePayload,
          unauthorizedField: 'malicious',
        })
        .expect(400);

      expect(res.body.message).toContain('property unauthorizedField should not exist');
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
    });

    it('should return 409 Conflict when username is already taken', async () => {
      mockUsersService.updateProfile.mockRejectedValue(
        new ConflictException('Username is already taken'),
      );

      const res = await request(app.getHttpServer())
        .put('/users/usr_123/profile')
        .send(validProfilePayload)
        .expect(409);

      expect(res.body.message).toBe('Username is already taken');
      expect(res.body.statusCode).toBe(409);
    });

    it('should return 404 Not Found when user does not exist', async () => {
      mockUsersService.updateProfile.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      const res = await request(app.getHttpServer())
        .put('/users/nonexistent/profile')
        .send(validProfilePayload)
        .expect(404);

      expect(res.body.message).toBe('User not found');
      expect(res.body.statusCode).toBe(404);
    });
  });

  // ==========================================
  // PUT /users/:userId/preferences
  // ==========================================
  describe('PUT /users/:userId/preferences', () => {
    const validPreferencesPayload = {
      language: 'Spanish',
      interests: ['gaming', 'anime'],
      goal: 'Casual chat',
    };

    it('should return 200 and updated preferences on valid request', async () => {
      const mockResult = {
        id: 'usr_123',
        ...validPreferencesPayload,
      };
      mockUsersService.updatePreferences.mockResolvedValue(mockResult);

      const res = await request(app.getHttpServer())
        .put('/users/usr_123/preferences')
        .send(validPreferencesPayload)
        .expect(200);

      expect(mockUsersService.updatePreferences).toHaveBeenCalledWith(
        'usr_123',
        validPreferencesPayload,
      );
      expect(res.body).toEqual(mockResult);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .put('/users/usr_123/preferences')
        .send({ language: 'English' })
        .expect(400);

      expect(res.body.message).toContain('interests must be an array');
      expect(res.body.message).toContain('goal should not be empty');
      expect(mockUsersService.updatePreferences).not.toHaveBeenCalled();
    });

    it('should return 400 when interests elements are not strings', async () => {
      const res = await request(app.getHttpServer())
        .put('/users/usr_123/preferences')
        .send({
          language: 'English',
          interests: [123, 456],
          goal: 'Chatting',
        })
        .expect(400);

      expect(res.body.message).toContain('each value in interests must be a string');
      expect(mockUsersService.updatePreferences).not.toHaveBeenCalled();
    });

    it('should return 404 Not Found when user does not exist', async () => {
      mockUsersService.updatePreferences.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      const res = await request(app.getHttpServer())
        .put('/users/nonexistent/preferences')
        .send(validPreferencesPayload)
        .expect(404);

      expect(res.body.message).toBe('User not found');
    });
  });

  // ==========================================
  // GET /users/:userId/profile
  // ==========================================
  describe('GET /users/:userId/profile', () => {
    it('should return 200 with user profile when found', async () => {
      const profile = {
        id: 'usr_123',
        username: 'alice',
        age: 22,
        gender: 'female',
        avatar: null,
        interests: ['books'],
        language: 'English',
        goal: 'Friends',
      };
      mockUsersService.getProfile.mockResolvedValue(profile);

      const res = await request(app.getHttpServer())
        .get('/users/usr_123/profile')
        .expect(200);

      expect(mockUsersService.getProfile).toHaveBeenCalledWith('usr_123');
      expect(res.body).toEqual(profile);
    });

    it('should return 404 Not Found when user does not exist', async () => {
      mockUsersService.getProfile.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      const res = await request(app.getHttpServer())
        .get('/users/usr_missing/profile')
        .expect(404);

      expect(res.body.message).toBe('User not found');
    });
  });

  // ==========================================
  // GET /users/me
  // ==========================================
  describe('GET /users/me', () => {
    it('should return 200 and the user profile for authenticated user', async () => {
      const mockProfile = {
        id: 'usr_me_123',
        username: 'chirp_persisted_user',
        age: 26,
        gender: 'female',
        avatar: 'https://chirp.app/avatar2.png',
        interests: ['movies', 'travel'],
        language: 'English',
        goal: 'Networking',
      };
      mockUsersService.getProfile.mockResolvedValue(mockProfile);

      // In the mock guard, we can pass request.user via middleware or simulate
      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer mock_valid_token')
        .expect(200);

      expect(res.body).toEqual(mockProfile);
    });

    it('should return 404 if user no longer exists in database', async () => {
      mockUsersService.getProfile.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer mock_valid_token')
        .expect(404);

      expect(res.body.message).toBe('User not found');
    });
  });

  // ==========================================
  // DELETE /users/:userId/account
  // ==========================================
  describe('DELETE /users/:userId/account', () => {
    it('should return 200 with success confirmation on account deletion', async () => {
      const deletionResult = {
        success: true,
        message: 'Account deleted successfully',
      };
      mockUsersService.deleteAccount.mockResolvedValue(deletionResult);

      const res = await request(app.getHttpServer())
        .delete('/users/usr_123/account')
        .expect(200);

      expect(mockUsersService.deleteAccount).toHaveBeenCalledWith('usr_123');
      expect(res.body).toEqual(deletionResult);
    });

    it('should return 404 Not Found when account to delete does not exist', async () => {
      mockUsersService.deleteAccount.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      const res = await request(app.getHttpServer())
        .delete('/users/usr_nonexistent/account')
        .expect(404);

      expect(res.body.message).toBe('User not found');
    });
  });

  // ==========================================
  // DELETE /users/:userId (alias route)
  // ==========================================
  describe('DELETE /users/:userId', () => {
    it('should return 200 via alias route and call deleteAccount', async () => {
      const deletionResult = {
        success: true,
        message: 'Account deleted successfully',
      };
      mockUsersService.deleteAccount.mockResolvedValue(deletionResult);

      const res = await request(app.getHttpServer())
        .delete('/users/usr_123')
        .expect(200);

      expect(mockUsersService.deleteAccount).toHaveBeenCalledWith('usr_123');
      expect(res.body).toEqual(deletionResult);
    });
  });
});
