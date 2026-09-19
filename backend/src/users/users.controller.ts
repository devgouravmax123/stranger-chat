import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { UsersService } from './users.service.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { SessionTokenService } from '../auth/session-token.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionTokenService: SessionTokenService,
  ) {}

  // ==========================================
  // CREATE / RETRIEVE SESSION TOKEN
  // ==========================================

  @Post('session')
  async createSession(@Body() body?: { userId?: string }) {
    let userId = body?.userId;
    if (userId) {
      const user = await this.usersService.getProfile(userId).catch(() => null);
      if (!user) {
        throw new NotFoundException('User not found');
      }
    } else {
      const newUser = await this.usersService.createAnonymousUser();
      userId = newUser.id;
    }
    const token = this.sessionTokenService.signToken(userId);
    return { userId, token };
  }

  // ==========================================
  // UPDATE BASIC PROFILE
  // ==========================================

  @Put(':userId/profile')
  @UseGuards(SessionAuthGuard)
  async updateProfile(
    @Param('userId') userId: string,
    @Body() dto: CreateProfileDto,
  ) {
    return this.usersService.updateProfile(
      userId,
      dto,
    );
  }

  // ==========================================
  // UPDATE MATCHING PREFERENCES
  // ==========================================

  @Put(':userId/preferences')
  @UseGuards(SessionAuthGuard)
  async updatePreferences(
    @Param('userId') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(
      userId,
      dto,
    );
  }

  // ==========================================
  // GET PROFILE
  // ==========================================

  @Get(':userId/profile')
  async getProfile(
    @Param('userId') userId: string,
  ) {
    return this.usersService.getProfile(
      userId,
    );
  }

  // ==========================================
  // DELETE USER ACCOUNT
  // ==========================================

  @Delete(':userId/account')
  @UseGuards(SessionAuthGuard)
  async deleteAccount(
    @Param('userId') userId: string,
  ) {
    return this.usersService.deleteAccount(userId);
  }

  @Delete(':userId')
  @UseGuards(SessionAuthGuard)
  async deleteUser(
    @Param('userId') userId: string,
  ) {
    return this.usersService.deleteAccount(userId);
  }
}