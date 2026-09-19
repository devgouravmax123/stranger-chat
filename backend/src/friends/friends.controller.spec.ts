import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';

describe('FriendsController (API)', () => {
  let app: INestApplication;
  let mockFriendsService: {
    searchUsers: ReturnType<typeof vi.fn>;
    discoverUsers: ReturnType<typeof vi.fn>;
    sendFriendRequest: ReturnType<typeof vi.fn>;
    getFriends: ReturnType<typeof vi.fn>;
    getFriendRequests: ReturnType<typeof vi.fn>;
    acceptFriendRequest: ReturnType<typeof vi.fn>;
    rejectFriendRequest: ReturnType<typeof vi.fn>;
    removeFriend: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockFriendsService = {
      searchUsers: vi.fn(),
      discoverUsers: vi.fn(),
      sendFriendRequest: vi.fn(),
      getFriends: vi.fn(),
      getFriendRequests: vi.fn(),
      acceptFriendRequest: vi.fn(),
      rejectFriendRequest: vi.fn(),
      removeFriend: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FriendsController],
      providers: [
        {
          provide: FriendsService,
          useValue: mockFriendsService,
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
  // GET /friends/search
  // ==========================================
  describe('GET /friends/search', () => {
    it('should return 200 and search results when valid params provided', async () => {
      const searchResults = [
        {
          id: 'user_2',
          username: 'charlie',
          age: 23,
          gender: 'male',
          avatar: null,
          isOnline: true,
          friendshipStatus: 'none',
        },
      ];
      mockFriendsService.searchUsers.mockResolvedValue(searchResults);

      const res = await request(app.getHttpServer())
        .get('/friends/search')
        .query({ userId: 'user_1', q: 'char' })
        .expect(200);

      expect(mockFriendsService.searchUsers).toHaveBeenCalledWith('user_1', 'char');
      expect(res.body).toEqual(searchResults);
    });

    it('should return 200 with empty list when no users match', async () => {
      mockFriendsService.searchUsers.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/friends/search')
        .query({ userId: 'user_1', q: 'nonexistent' })
        .expect(200);

      expect(mockFriendsService.searchUsers).toHaveBeenCalledWith('user_1', 'nonexistent');
      expect(res.body).toEqual([]);
    });
  });

  // ==========================================
  // GET /friends/discover
  // ==========================================
  describe('GET /friends/discover', () => {
    it('should return 200 with parsed default pagination and filters', async () => {
      const discoverResults = {
        users: [
          {
            id: 'u_10',
            username: 'coder_dev',
            age: 25,
            gender: 'female',
            interests: ['Coding', 'Gaming'],
            friendshipStatus: 'none',
          },
        ],
        total: 1,
        hasMore: false,
      };
      mockFriendsService.discoverUsers.mockResolvedValue(discoverResults);

      const res = await request(app.getHttpServer())
        .get('/friends/discover')
        .query({
          userId: 'user_1',
          q: 'coder',
          onlineOnly: 'true',
          gender: 'female',
          interests: 'Coding, Gaming',
          limit: '15',
          offset: '0',
        })
        .expect(200);

      expect(mockFriendsService.discoverUsers).toHaveBeenCalledWith({
        currentUserId: 'user_1',
        query: 'coder',
        onlineOnly: true,
        gender: 'female',
        interests: ['Coding', 'Gaming'],
        limit: 15,
        offset: 0,
      });
      expect(res.body).toEqual(discoverResults);
    });

    it('should clamp limit between 1 and 50 and sanitize offset', async () => {
      mockFriendsService.discoverUsers.mockResolvedValue({ users: [], total: 0, hasMore: false });

      // Test boundary: limit > 50 clamped to 50, negative offset clamped to 0
      await request(app.getHttpServer())
        .get('/friends/discover')
        .query({
          userId: 'user_1',
          limit: '100',
          offset: '-5',
        })
        .expect(200);

      expect(mockFriendsService.discoverUsers).toHaveBeenCalledWith({
        currentUserId: 'user_1',
        query: undefined,
        onlineOnly: false,
        gender: undefined,
        interests: undefined,
        limit: 50,
        offset: 0,
      });

      // Test boundary: limit < 1 clamped to 1
      await request(app.getHttpServer())
        .get('/friends/discover')
        .query({
          userId: 'user_1',
          limit: '0',
        })
        .expect(200);

      expect(mockFriendsService.discoverUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20, // 0 is falsy, defaults to 20
        }),
      );
    });
  });

  // ==========================================
  // POST /friends/request
  // ==========================================
  describe('POST /friends/request', () => {
    it('should return 201 when friend request is sent successfully', async () => {
      const requestPayload = {
        senderId: 'usr_alice',
        receiverId: 'usr_bob',
      };
      const responseData = {
        success: true,
        request: {
          id: 'req_123',
          senderId: 'usr_alice',
          receiverId: 'usr_bob',
          status: 'PENDING',
        },
      };
      mockFriendsService.sendFriendRequest.mockResolvedValue(responseData);

      const res = await request(app.getHttpServer())
        .post('/friends/request')
        .send(requestPayload)
        .expect(201);

      expect(mockFriendsService.sendFriendRequest).toHaveBeenCalledWith('usr_alice', 'usr_bob');
      expect(res.body).toEqual(responseData);
    });

    it('should return 400 Bad Request when attempting to friend oneself', async () => {
      mockFriendsService.sendFriendRequest.mockRejectedValue(
        new BadRequestException('You cannot send a friend request to yourself'),
      );

      const res = await request(app.getHttpServer())
        .post('/friends/request')
        .send({ senderId: 'usr_same', receiverId: 'usr_same' })
        .expect(400);

      expect(res.body.message).toBe('You cannot send a friend request to yourself');
    });

    it('should return 400 Bad Request when users are already friends or pending', async () => {
      mockFriendsService.sendFriendRequest.mockRejectedValue(
        new BadRequestException('A friend request is already pending'),
      );

      const res = await request(app.getHttpServer())
        .post('/friends/request')
        .send({ senderId: 'usr_alice', receiverId: 'usr_bob' })
        .expect(400);

      expect(res.body.message).toBe('A friend request is already pending');
    });

    it('should return 404 Not Found when target user does not exist', async () => {
      mockFriendsService.sendFriendRequest.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      const res = await request(app.getHttpServer())
        .post('/friends/request')
        .send({ senderId: 'usr_alice', receiverId: 'usr_nonexistent' })
        .expect(404);

      expect(res.body.message).toBe('User not found');
    });
  });

  // ==========================================
  // GET /friends/:userId
  // ==========================================
  describe('GET /friends/:userId', () => {
    it('should return 200 and list of accepted friends', async () => {
      const friendsList = [
        {
          friendshipId: 'fr_1',
          friend: {
            id: 'usr_bob',
            username: 'bob',
            isOnline: false,
          },
        },
      ];
      mockFriendsService.getFriends.mockResolvedValue(friendsList);

      const res = await request(app.getHttpServer())
        .get('/friends/usr_alice')
        .expect(200);

      expect(mockFriendsService.getFriends).toHaveBeenCalledWith('usr_alice');
      expect(res.body).toEqual(friendsList);
    });
  });

  // ==========================================
  // GET /friends/requests/:userId
  // ==========================================
  describe('GET /friends/requests/:userId', () => {
    it('should return 200 and list of pending friend requests', async () => {
      const pendingRequests = [
        {
          id: 'req_1',
          senderId: 'usr_charlie',
          createdAt: new Date().toISOString(),
          sender: { username: 'charlie' },
        },
      ];
      mockFriendsService.getFriendRequests.mockResolvedValue(pendingRequests);

      const res = await request(app.getHttpServer())
        .get('/friends/requests/usr_alice')
        .expect(200);

      expect(mockFriendsService.getFriendRequests).toHaveBeenCalledWith('usr_alice');
      expect(res.body).toEqual(pendingRequests);
    });
  });

  // ==========================================
  // PUT /friends/request/:requestId/accept
  // ==========================================
  describe('PUT /friends/request/:requestId/accept', () => {
    it('should return 200 when friend request is successfully accepted', async () => {
      const acceptedResponse = {
        success: true,
        friendship: {
          id: 'fr_999',
          user1Id: 'usr_sender',
          user2Id: 'usr_receiver',
        },
      };
      mockFriendsService.acceptFriendRequest.mockResolvedValue(acceptedResponse);

      const res = await request(app.getHttpServer())
        .put('/friends/request/req_123/accept')
        .send({ userId: 'usr_receiver' })
        .expect(200);

      expect(mockFriendsService.acceptFriendRequest).toHaveBeenCalledWith(
        'req_123',
        'usr_receiver',
      );
      expect(res.body).toEqual(acceptedResponse);
    });

    it('should return 403 Forbidden when unauthorized user tries to accept someone elses request', async () => {
      mockFriendsService.acceptFriendRequest.mockRejectedValue(
        new ForbiddenException('You are not authorized to accept this friend request'),
      );

      const res = await request(app.getHttpServer())
        .put('/friends/request/req_123/accept')
        .send({ userId: 'usr_imposter' })
        .expect(403);

      expect(res.body.message).toBe('You are not authorized to accept this friend request');
    });

    it('should return 404 Not Found when request does not exist', async () => {
      mockFriendsService.acceptFriendRequest.mockRejectedValue(
        new NotFoundException('Friend request not found'),
      );

      const res = await request(app.getHttpServer())
        .put('/friends/request/req_missing/accept')
        .send({ userId: 'usr_receiver' })
        .expect(404);

      expect(res.body.message).toBe('Friend request not found');
    });
  });

  // ==========================================
  // PUT /friends/request/:requestId/reject
  // ==========================================
  describe('PUT /friends/request/:requestId/reject', () => {
    it('should return 200 when friend request is rejected', async () => {
      const rejectResponse = {
        success: true,
        message: 'Friend request rejected',
      };
      mockFriendsService.rejectFriendRequest.mockResolvedValue(rejectResponse);

      const res = await request(app.getHttpServer())
        .put('/friends/request/req_123/reject')
        .send({ userId: 'usr_receiver' })
        .expect(200);

      expect(mockFriendsService.rejectFriendRequest).toHaveBeenCalledWith(
        'req_123',
        'usr_receiver',
      );
      expect(res.body).toEqual(rejectResponse);
    });

    it('should return 403 Forbidden when unauthorized user tries to reject', async () => {
      mockFriendsService.rejectFriendRequest.mockRejectedValue(
        new ForbiddenException('You are not authorized to reject this friend request'),
      );

      const res = await request(app.getHttpServer())
        .put('/friends/request/req_123/reject')
        .send({ userId: 'usr_imposter' })
        .expect(403);

      expect(res.body.message).toBe('You are not authorized to reject this friend request');
    });
  });

  // ==========================================
  // DELETE /friends/:userId/:friendId
  // ==========================================
  describe('DELETE /friends/:userId/:friendId', () => {
    it('should return 200 when friend is removed', async () => {
      const removeResponse = {
        success: true,
        message: 'Friend removed successfully',
      };
      mockFriendsService.removeFriend.mockResolvedValue(removeResponse);

      const res = await request(app.getHttpServer())
        .delete('/friends/usr_alice/usr_bob')
        .expect(200);

      expect(mockFriendsService.removeFriend).toHaveBeenCalledWith('usr_alice', 'usr_bob');
      expect(res.body).toEqual(removeResponse);
    });

    it('should return 404 Not Found when friendship does not exist', async () => {
      mockFriendsService.removeFriend.mockRejectedValue(
        new NotFoundException('Friendship not found'),
      );

      const res = await request(app.getHttpServer())
        .delete('/friends/usr_alice/usr_stranger')
        .expect(404);

      expect(res.body.message).toBe('Friendship not found');
    });
  });
});
