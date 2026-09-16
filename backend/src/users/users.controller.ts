import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
} from '@nestjs/common';

import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  // ==========================================
  // UPDATE BASIC PROFILE
  // ==========================================

  @Put(':userId/profile')
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
  async deleteAccount(
    @Param('userId') userId: string,
  ) {
    return this.usersService.deleteAccount(userId);
  }

  @Delete(':userId')
  async deleteUser(
    @Param('userId') userId: string,
  ) {
    return this.usersService.deleteAccount(userId);
  }
}