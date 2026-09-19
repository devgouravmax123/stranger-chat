import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  userId: string;
  iat: number;
  exp: number;
}

@Injectable()
export class SessionTokenService {
  private readonly secret: string;
  private readonly defaultExpiryMs = 30 * 24 * 60 * 60 * 1000; // 30 days for ephemeral anonymous sessions

  constructor() {
    this.secret = process.env.SESSION_SECRET || 'chirp-ephemeral-session-secret-2026-key-v1';
  }

  /**
   * Signs an ephemeral session token containing the user's UUID.
   */
  signToken(userId: string, expiresInMs?: number): string {
    const iat = Date.now();
    const exp = iat + (expiresInMs ?? this.defaultExpiryMs);
    const payload: SessionPayload = { userId, iat, exp };

    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(data).digest('base64url');

    return `${data}.${signature}`;
  }

  /**
   * Verifies the token signature and expiration.
   * Returns the verified payload or null if invalid/expired.
   */
  verifyToken(token: string): SessionPayload | null {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [data, signature] = parts;
    if (!data || !signature) return null;

    const expectedSignature = createHmac('sha256', this.secret).update(data).digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    try {
      const payloadJson = Buffer.from(data, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as SessionPayload;

      if (!payload.userId || typeof payload.userId !== 'string') {
        return null;
      }

      if (payload.exp && Date.now() > payload.exp) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }
}
