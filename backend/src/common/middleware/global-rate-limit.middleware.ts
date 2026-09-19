import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

@Injectable()
export class GlobalRateLimitMiddleware implements NestMiddleware {
  private readonly ipRequests = new Map<string, RateLimitEntry>();
  private readonly windowMs = 60 * 1000; // 1 minute
  private readonly maxRequests = 120; // 120 req / min per IP

  constructor() {
    // Prune stale IP entries every 2 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of this.ipRequests.entries()) {
        if (now > entry.resetTime) {
          this.ipRequests.delete(ip);
        }
      }
    }, 2 * 60 * 1000).unref();
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Do not throttle Socket.IO polling / transport handshakes
    if (req.path.startsWith('/socket.io')) {
      return next();
    }

    // When Express trust proxy is enabled, Express derives req.ip safely according to the configured trusted proxy settings.
    // When trust proxy is disabled (default), direct socket remoteAddress is used so clients CANNOT spoof their IP via X-Forwarded-For.
    const isTrustProxy = Boolean(req.app?.get('trust proxy'));
    const ip = isTrustProxy
      ? (req.ip || req.socket.remoteAddress || 'unknown')
      : (req.socket.remoteAddress || req.ip || 'unknown');

    const now = Date.now();
    let entry = this.ipRequests.get(ip);

    if (!entry || now > entry.resetTime) {
      entry = { count: 1, resetTime: now + this.windowMs };
      this.ipRequests.set(ip, entry);
    } else {
      entry.count++;
    }

    res.setHeader('X-RateLimit-Limit', this.maxRequests.toString());
    res.setHeader(
      'X-RateLimit-Remaining',
      Math.max(0, this.maxRequests - entry.count).toString(),
    );
    res.setHeader(
      'X-RateLimit-Reset',
      Math.ceil(entry.resetTime / 1000).toString(),
    );

    if (entry.count > this.maxRequests) {
      return res.status(429).json({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many requests, please try again later.',
      });
    }

    next();
  }
}
