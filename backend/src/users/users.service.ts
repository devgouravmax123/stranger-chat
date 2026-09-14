import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';
import { CreateProfileDto } from './dto/create-profile.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, dto: CreateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: {
        username: dto.username.trim(),
      },
    });

    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException(
        'Username already taken. Please choose another username.',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        username: dto.username.trim(),
        age: dto.age,
        gender: dto.gender.trim(),
        avatar: dto.avatar?.trim() || null,
      },
      select: {
        id: true,
        username: true,
        age: true,
        gender: true,
        avatar: true,
      },
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        age: true,
        gender: true,
        avatar: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}