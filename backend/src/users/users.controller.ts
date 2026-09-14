import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';

import { CreateProfileDto } from './dto/create-profile.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  // ==========================================
  // UPDATE PROFILE
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
}