/**
 * Chirp - Centralized API & Backend Configuration
 *
 * Provides environment-driven backend URL resolution for REST endpoints and Socket.IO.
 * In development, defaults to http://localhost:3001.
 * In production, reads NEXT_PUBLIC_BACKEND_URL.
 */

export const BACKEND_URL: string =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BACKEND_URL) ||
  "http://localhost:3001";
