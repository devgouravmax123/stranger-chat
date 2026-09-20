/**
 * Centralized CORS & Origin Configuration
 *
 * Normalizes origins so that trailing slashes are strictly stripped.
 * Browsers send `Origin: https://domain.com` without a trailing slash per RFC 6454.
 * If backend returns an origin with a trailing slash, browsers reject CORS.
 */

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'https://stranger-chat-gamma-five.vercel.app',
];

/**
 * Normalizes an origin string by trimming whitespace and stripping trailing slashes.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

/**
 * Resolves allowed origins from the environment or default fallback list.
 * Supports comma-delimited origins in FRONTEND_URL or CORS_ORIGIN.
 */
export function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ORIGIN || process.env.FRONTEND_URL;
  if (!envOrigins) {
    return DEFAULT_ORIGINS.map(normalizeOrigin);
  }

  const origins = envOrigins
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter((o) => o.length > 0);

  // Always make sure default origins or configured origins are available if desired,
  // or return the sanitized list. If production vercel url is known, include it if env matches.
  return origins.length > 0 ? origins : DEFAULT_ORIGINS.map(normalizeOrigin);
}

/**
 * Standard CORS origin checker/resolver compatible with Express (app.enableCors)
 * and Socket.IO (@WebSocketGateway).
 */
export function isOriginAllowed(origin: string | undefined, callback?: (err: Error | null, allow?: boolean) => void): boolean | void {
  // Allow requests with no origin (like mobile apps, curl, server-to-server)
  if (!origin) {
    if (callback) return callback(null, true);
    return true;
  }

  const cleanOrigin = normalizeOrigin(origin);
  const allowed = getAllowedOrigins();

  const isAllowed = allowed.includes(cleanOrigin);

  if (callback) {
    return callback(null, isAllowed);
  }
  return isAllowed;
}

/**
 * CORS configuration object for Socket.IO gateway and Express HTTP CORS
 */
export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // If no origin (e.g. same-origin, curl, server-to-server), allow
    if (!origin) {
      return callback(null, true);
    }

    const cleanOrigin = normalizeOrigin(origin);
    const allowed = getAllowedOrigins();

    if (allowed.includes(cleanOrigin)) {
      return callback(null, true);
    }

    // In non-production, be lenient with localhost ports
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(cleanOrigin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS origin not allowed: ${origin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};
