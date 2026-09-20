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
 * Matches official Vercel preview deployments belonging to the stranger-chat project:
 * e.g. https://stranger-chat-1dn68p8eu-gourav-080c.vercel.app
 *
 * Pattern breakdown:
 * - ^https:\/\/stranger-chat-
 * - [a-zA-Z0-9_-]+
 * - \.vercel\.app$
 *
 * Rejects unrelated origins (e.g. evil-example.vercel.app, stranger-chat.otherdomain.com).
 */
export const VERCEL_PREVIEW_ORIGIN_REGEX = /^https:\/\/stranger-chat-[a-zA-Z0-9_-]+\.vercel\.app$/;

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

  return origins.length > 0 ? origins : DEFAULT_ORIGINS.map(normalizeOrigin);
}

/**
 * Checks if a given origin is allowed under the security policy:
 * 1. Missing/undefined origin (e.g., server-to-server, mobile apps, curl) -> allowed
 * 2. Explicitly configured origins (env vars or DEFAULT_ORIGINS including production) -> allowed
 * 3. Vercel preview deployments matching https://stranger-chat-*.vercel.app -> allowed
 * 4. Localhost ports in non-production environments -> allowed
 * 5. All other origins -> rejected
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  const cleanOrigin = normalizeOrigin(origin);
  const allowed = getAllowedOrigins();

  if (allowed.includes(cleanOrigin)) {
    return true;
  }

  if (VERCEL_PREVIEW_ORIGIN_REGEX.test(cleanOrigin)) {
    return true;
  }

  // In non-production, allow localhost development ports
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(cleanOrigin)) {
    return true;
  }

  return false;
}

/**
 * Standard CORS origin checker/resolver compatible with Express (app.enableCors)
 * and Socket.IO (@WebSocketGateway).
 */
export function isOriginAllowed(
  origin: string | undefined,
  callback?: (err: Error | null, allow?: boolean) => void,
): boolean | void {
  const allowed = isAllowedOrigin(origin);

  if (callback) {
    return callback(null, allowed);
  }
  return allowed;
}

/**
 * CORS configuration object for Socket.IO gateway and Express HTTP CORS
 */
export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS origin not allowed: ${origin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};
