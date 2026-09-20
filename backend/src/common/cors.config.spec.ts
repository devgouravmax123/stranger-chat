import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeOrigin,
  getAllowedOrigins,
  isAllowedOrigin,
  isOriginAllowed,
  corsOptions,
  VERCEL_PREVIEW_ORIGIN_REGEX,
} from './cors.config.js';

describe('CORS Configuration', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
    process.env.CORS_ORIGIN = originalCorsOrigin;
    process.env.NODE_ENV = originalNodeEnv;
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

  describe('VERCEL_PREVIEW_ORIGIN_REGEX', () => {
    it('should match valid stranger-chat vercel preview URLs', () => {
      expect(
        VERCEL_PREVIEW_ORIGIN_REGEX.test(
          'https://stranger-chat-1dn68p8eu-gourav-080c.vercel.app',
        ),
      ).toBe(true);
      expect(
        VERCEL_PREVIEW_ORIGIN_REGEX.test('https://stranger-chat-preview-123.vercel.app'),
      ).toBe(true);
    });

    it('should reject unrelated vercel domains or non-vercel domains', () => {
      expect(VERCEL_PREVIEW_ORIGIN_REGEX.test('https://evil-example.vercel.app')).toBe(false);
      expect(VERCEL_PREVIEW_ORIGIN_REGEX.test('https://stranger-chat.com')).toBe(false);
      expect(
        VERCEL_PREVIEW_ORIGIN_REGEX.test('http://stranger-chat-123.vercel.app'),
      ).toBe(false);
      expect(
        VERCEL_PREVIEW_ORIGIN_REGEX.test('https://stranger-chat.otherdomain.vercel.app.attacker.com'),
      ).toBe(false);
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

  describe('isAllowedOrigin / isOriginAllowed', () => {
    it('ALLOWED: should allow production frontend without or with trailing slash', () => {
      expect(isAllowedOrigin('https://stranger-chat-gamma-five.vercel.app')).toBe(true);
      expect(isAllowedOrigin('https://stranger-chat-gamma-five.vercel.app/')).toBe(true);
      expect(isOriginAllowed('https://stranger-chat-gamma-five.vercel.app')).toBe(true);
    });

    it('ALLOWED: should allow Vercel preview deployment matching stranger-chat-*.vercel.app without or with trailing slash', () => {
      expect(
        isAllowedOrigin('https://stranger-chat-1dn68p8eu-gourav-080c.vercel.app'),
      ).toBe(true);
      expect(
        isAllowedOrigin('https://stranger-chat-1dn68p8eu-gourav-080c.vercel.app/'),
      ).toBe(true);
      expect(
        isOriginAllowed('https://stranger-chat-1dn68p8eu-gourav-080c.vercel.app'),
      ).toBe(true);
    });

    it('REJECTED: should reject evil-example.vercel.app', () => {
      expect(isAllowedOrigin('https://evil-example.vercel.app')).toBe(false);
      expect(isOriginAllowed('https://evil-example.vercel.app')).toBe(false);
    });

    it('REJECTED: should reject example.com', () => {
      expect(isAllowedOrigin('https://example.com')).toBe(false);
      expect(isOriginAllowed('https://example.com')).toBe(false);
    });

    it('should support localhost:3000 in development / non-production', () => {
      process.env.NODE_ENV = 'development';
      expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
      expect(isAllowedOrigin('http://localhost:3001')).toBe(true);
    });

    it('should allow undefined/null origin (same-origin, curl, server-to-server)', () => {
      expect(isAllowedOrigin(undefined)).toBe(true);
      expect(isOriginAllowed(undefined)).toBe(true);
    });
  });

  describe('corsOptions origin callback handler', () => {
    it('should allow production vercel origin and return true', (done) => {
      corsOptions.origin('https://stranger-chat-gamma-five.vercel.app', (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
      });
    });

    it('should allow preview vercel origin with trailing slash after normalization', (done) => {
      corsOptions.origin(
        'https://stranger-chat-1dn68p8eu-gourav-080c.vercel.app/',
        (err, allow) => {
          expect(err).toBeNull();
          expect(allow).toBe(true);
        },
      );
    });

    it('should allow requests with undefined origin', (done) => {
      corsOptions.origin(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
      });
    });

    it('should reject evil-example.vercel.app with Error', (done) => {
      corsOptions.origin('https://evil-example.vercel.app', (err, allow) => {
        expect(err).toBeInstanceOf(Error);
        expect(allow).toBe(false);
      });
    });

    it('should reject example.com with Error', (done) => {
      corsOptions.origin('https://example.com', (err, allow) => {
        expect(err).toBeInstanceOf(Error);
        expect(allow).toBe(false);
      });
    });
  });
});
