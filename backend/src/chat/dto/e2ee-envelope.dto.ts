/**
 * Backend E2EE Message Envelope DTO and Type Guards
 *
 * Implements strict structural validation for the versioned E2EE envelope.
 *
 * SECURITY INVARIANT:
 * The backend MUST treat the envelope as an opaque ciphertext container.
 * The backend NEVER decrypts, inspects, truncates, transforms, or logs
 * the underlying plaintext.
 */

export interface BackendE2EEMessageEnvelope {
  e2ee: true;
  v: 1;
  iv: string; // Base64 representation of exactly 12-byte IV
  ct: string; // Base64 ciphertext + GCM auth tag
}

const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Validates whether an untrusted value matches the exact E2EEMessageEnvelope structure.
 *
 * Checks:
 * - non-null object, not an array
 * - e2ee === true
 * - v === 1
 * - iv is valid Base64 string that decodes to exactly 12 bytes
 * - ct is a non-empty valid Base64 string
 */
export function isValidE2EEEnvelope(value: unknown): value is BackendE2EEMessageEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.e2ee !== true || candidate.v !== 1) {
    return false;
  }

  if (typeof candidate.iv !== 'string' || typeof candidate.ct !== 'string') {
    return false;
  }

  if (candidate.ct.length === 0) {
    return false;
  }

  if (!BASE64_REGEX.test(candidate.iv) || !BASE64_REGEX.test(candidate.ct)) {
    return false;
  }

  try {
    const ivBuf = Buffer.from(candidate.iv, 'base64');
    if (ivBuf.length !== 12) {
      return false;
    }
    // Ensure base64 roundtrip / non-empty decoding
    const ctBuf = Buffer.from(candidate.ct, 'base64');
    if (ctBuf.length === 0) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Parses and strictly validates a raw JSON string into a BackendE2EEMessageEnvelope.
 * Returns null on any malformed or non-envelope input.
 */
export function parseE2EEEnvelope(raw: string): BackendE2EEMessageEnvelope | null {
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (isValidE2EEEnvelope(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
