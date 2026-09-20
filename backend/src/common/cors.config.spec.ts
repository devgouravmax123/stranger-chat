import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeOrigin, getAllowedOrigins, corsOptions } from './cors.config.js';

describe('CORS Configuration', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  beforeEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.CORS_ORIGIN;
  });

  afterEach(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
    process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  describe('normalizeOrigin', () => {
    it('should strip trailing slashes from origins', () => {
      expect(normalizeOrigin('https://stranger-chat-gamma-five.vercel.app/')).toBe(
        'https://stranger-chat-gamma-five.vercel.app',
      );
      expect(normalizeOrigin('https://stranger-chat-gamma-five.vercel.app///')).toBe(
        'https://stranger-chat-gamma-five.vercel.app',
      );
      expect(normalizeOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
    });

    it('should trim surrounding whitespace', () => {
      expect(normalizeOrigin('  https://stranger-chat-gamma-five.vercel.app/  ')).toBe(
        'https://stranger-chat-gamma-five.vercel.app',
      );
    });
  });

  describe('getAllowedOrigins', () => {
    it('should strip trailing slashes when FRONTEND_URL is configured with trailing slash', () => {
      process.env.FRONTEND_URL = 'https://stranger-chat-gamma-five.vercel.app/';
      const allowed = getAllowedOrigins();
      expect(allowed).toContain('https://stranger-chat-gamma-five.vercel.app');
      expect(allowed).not.toContain('https://stranger-chat-gamma-five.vercel.app/');
    });

    it('should handle comma-separated origins with trailing slashes', () => {
      process.env.FRONTEND_URL =
        'https://stranger-chat-gamma-five.vercel.app/, http://localhost:3000/';
      const allowed = getAllowedOrigins();
      expect(allowed).toEqual([
        'https://stranger-chat-gamma-five.vercel.app',
        'http://localhost:3000',
      ]);
    });

    it('should include the production Vercel app in defaults even if no env var is passed', () => {
      const allowed = getAllowedOrigins();
      expect(allowed).toContain('https://stranger-chat-gamma-five.vercel.app');
      expect(allowed).toContain('http://localhost:3000');
      for (const origin of allowed) {
        expect(origin.endsWith('/')).toBe(false);
      }
    });
  });

  describe('corsOptions origin handler', () => {
    it('should accept production vercel origin without trailing slash', (done) => {
      process.env.FRONTEND_URL = 'https://stranger-chat-gamma-five.vercel.app/';
      corsOptions.origin('https://stranger-chat-gamma-five.vercel.app', (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
      });
    });

    it('should allow requests with undefined origin (same-origin / server-to-server)', () => {
      corsOptions.origin(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
      });
    });

    it('should reject unauthorized foreign origin', () => {
      process.env.FRONTEND_URL = 'https://stranger-chat-gamma-five.vercel.app';
      corsOptions.origin('https://malicious-site.com', (err, allow) => {
        expect(err).toBeInstanceOf(Error);
        expect(allow).toBe(false);
      });
    });
  });
});
