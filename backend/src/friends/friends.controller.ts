import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { FriendsService } from './friends.service.js';

@Controller('friends')
export class FriendsController {
  constructor(
    private readonly friendsService: FriendsService,
  ) {}

  // ==========================================
  // SEARCH USERS / POTENTIAL FRIENDS
  // GET /friends/search?userId=xxx&q=yyy
  // ==========================================

  @Get('search')
  async searchUsers(
    @Query('userId') userId: string,
    @Query('q') q: string,
  ) {
    return this.friendsService.searchUsers(userId, q);
  }

  // ==========================================
  // DISCOVER USERS (SEARCH + ADVANCED FILTERS)
  // GET /friends/discover?userId=xxx&q=yyy&onlineOnly=true&gender=female&interests=Coding,Gaming
  // ==========================================

  @Get('discover')
  async discoverUsers(
    @Query('userId') userId: string,
    @Query('q') q?: string,
    @Query('onlineOnly') onlineOnly?: string,
    @Query('gender') gender?: string,
    @Query('interests') interests?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const isOnlineOnly = onlineOnly === 'true' || onlineOnly === '1';
    const interestsList = interests
      ? interests.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50) : 20;
    const parsedOffset = offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0;

    return this.friendsService.discoverUsers({
      currentUserId: userId,
      query: q,
      onlineOnly: isOnlineOnly,
      gender,
      interests: interestsList,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  }

  // ==========================================
  // SEND FRIEND REQUEST
  // POST /friends/request
  // ==========================================

  @Post('request')
  async sendFriendRequest(
    @Body()
    body: {
      senderId: string;
      receiverId: string;
    },
  ) {
    return this.friendsService.sendFriendRequest(
      body.senderId,
      body.receiverId,
    );
  }

  // ==========================================
  // GET FRIENDS
  // GET /friends/:userId
  // ==========================================

  @Get(':userId')
  async getFriends(
    @Param('userId') userId: string,
  ) {
    return this.friendsService.getFriends(userId);
  }

  // ==========================================
  // GET FRIEND REQUESTS
  // GET /friends/requests/:userId
  // ==========================================

  @Get('requests/:userId')
  async getFriendRequests(
    @Param('userId') userId: string,
  ) {
    return this.friendsService.getFriendRequests(userId);
  }

  // ==========================================
  // ACCEPT REQUEST
  // PUT /friends/request/:requestId/accept
  // ==========================================

  @Put('request/:requestId/accept')
  async acceptFriendRequest(
    @Param('requestId') requestId: string,
    @Body() body: { userId: string },
  ) {
    return this.friendsService.acceptFriendRequest(
      requestId,
      body.userId,
    );
  }

  // ==========================================
  // REJECT REQUEST
  // PUT /friends/request/:requestId/reject
  // ==========================================

  @Put('request/:requestId/reject')
  async rejectFriendRequest(
    @Param('requestId') requestId: string,
    @Body() body: { userId: string },
  ) {
    return this.friendsService.rejectFriendRequest(
      requestId,
      body.userId,
    );
  }

  // ==========================================
  // REMOVE FRIEND
  // DELETE /friends/:userId/:friendId
  // ==========================================

  @Delete(':userId/:friendId')
  async removeFriend(
    @Param('userId') userId: string,
    @Param('friendId') friendId: string,
  ) {
    return this.friendsService.removeFriend(
      userId,
      friendId,
    );
  }
}