import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';
import { CreateProfileDto } from './dto/create-profile.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // UPDATE PROFILE
  // ==========================================

  async updateProfile(
    userId: string,
    dto: CreateProfileDto,
  ) {
    const user =
      await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }

    // ==========================================
    // CHECK USERNAME
    // ==========================================

    const existingUser =
      await this.prisma.user.findUnique({
        where: {
          username: dto.username.trim(),
        },
      });

    if (
      existingUser &&
      existingUser.id !== userId
    ) {
      throw new ConflictException(
        'Username already taken. Please choose another username.',
      );
    }

    // ==========================================
    // CLEAN INTERESTS
    // ==========================================

    const cleanInterests =
      Array.isArray(dto.interests)
        ? dto.interests
            .map((interest) =>
              interest.trim(),
            )
            .filter(
              (interest) =>
                interest.length > 0,
            )
        : [];

    // ==========================================
    // UPDATE
    // ==========================================

    return this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        username:
          dto.username.trim(),

        age: dto.age,

        gender:
          dto.gender.trim(),

        avatar:
          dto.avatar?.trim() || null,

        language:
          dto.language.trim(),

        interests:
          cleanInterests,

        goal:
          dto.goal.trim(),
      },

      select: {
        id: true,
        username: true,
        age: true,
        gender: true,
        avatar: true,
        language: true,
        interests: true,
        goal: true,
      },
    });
  }

  // ==========================================
  // GET PROFILE
  // ==========================================

  async getProfile(
    userId: string,
  ) {
    const user =
      await this.prisma.user.findUnique({
        where: {
          id: userId,
        },

        select: {
          id: true,
          username: true,
          age: true,
          gender: true,
          avatar: true,
          language: true,
          interests: true,
          goal: true,
        },
      });

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }

    return user;
  }
}