import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionTokenService } from './session-token.service.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessionTokenService: SessionTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    let token: string | undefined;
    const authHeader = request.headers?.authorization;
    if (authHeader && typeof authHeader === 'string') {
      const [type, credentials] = authHeader.split(' ');
      if (type?.toLowerCase() === 'bearer' && credentials) {
        token = credentials;
      }
    }

    if (!token && request.headers?.['x-session-token']) {
      token = request.headers['x-session-token'] as string;
    }

    if (!token) {
      throw new UnauthorizedException('Session token is required');
    }

    const payload = this.sessionTokenService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    // IDOR protection: if the request specifies a :userId param, verify the token belongs to that user
    const targetUserId = request.params?.userId;
    if (targetUserId && targetUserId !== payload.userId) {
      throw new ForbiddenException(
        'You cannot access or modify resources belonging to another user',
      );
    }

    request.user = payload;
    return true;
  }
}
