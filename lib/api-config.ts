/**
 * Chirp - Centralized API & Backend Configuration
 *
 * Provides environment-driven backend URL resolution for REST endpoints and Socket.IO.
 * In production, reads NEXT_PUBLIC_API_URL (or NEXT_PUBLIC_BACKEND_URL).
 * In development, falls back to http://localhost:3001.
 * Automatically trims trailing slashes to prevent connection and CORS routing issues.
 */

const rawBackendUrl: string =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:3001";

export const BACKEND_URL: string = rawBackendUrl.trim().replace(/\/+$/, "");

