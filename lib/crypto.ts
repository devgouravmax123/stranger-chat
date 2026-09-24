/**
 * E2EE Cryptographic Core for Chirp
 *
 * Implements standard browser cryptography using native Web Crypto API (SubtleCrypto):
 * - Key Exchange: ECDH (Elliptic Curve Diffie-Hellman) with NIST P-256 (secp256r1)
 * - Key Derivation: HKDF-SHA-256 to derive a 256-bit AES-GCM symmetric key
 * - Symmetric Cipher: AES-GCM 256-bit with unique cryptographically random 12-byte IV per message
 * - Key Storage: Dedicated IndexedDB object store with non-extractable CryptoKey private keys
 * - Optional AAD: Additional Authenticated Data binding for message integrity verification
 *
 * Security Guarantees:
 * - Private keys are non-extractable by default and stored directly in IndexedDB as structured CryptoKey objects.
 * - Private keys never leave the browser: never sent over network, never in localStorage/sessionStorage, never in logs.
 * - Public keys are exported to compact Base64 strings (SPKI format) for transmission over network.
 */

// ==========================================
// CONSTANTS & TYPES
// ==========================================

const DB_NAME = "chirp_e2ee_keystore";
const DB_VERSION = 1;
const STORE_NAME = "keypairs";
const IDENTITY_KEY_ID = "chirp_identity_keypair";

export type EncryptedPayload = {
  ciphertext: string; // Base64 encoded ciphertext + auth tag
  iv: string; // Base64 encoded 12-byte initialization vector
};

export type KeyPairResult = {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
};

// ==========================================
// BINARY / BASE64 ENCODING HELPERS
// ==========================================

/**
 * Converts an ArrayBuffer to a Base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("[E2EE] Base64 encoding is not supported in this environment.");
}

/**
 * Converts a Base64 string to an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  throw new Error("[E2EE] Base64 decoding is not supported in this environment.");
}

/**
 * Generates cryptographically secure random bytes.
 */
export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj =
    (typeof window !== "undefined" && window.crypto) ||
    (typeof globalThis !== "undefined" && (globalThis as any).crypto);

  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error("[E2EE] Cryptographically secure random number generator is unavailable.");
  }

  return cryptoObj.getRandomValues(bytes);
}

// ==========================================
// ENVIRONMENT GUARDS
// ==========================================

function getSubtleCrypto(): SubtleCrypto {
  const cryptoObj =
    (typeof window !== "undefined" && window.crypto) ||
    (typeof globalThis !== "undefined" && (globalThis as any).crypto);

  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error(
      "[E2EE] Web Crypto API (SubtleCrypto) is only available in secure browser environments."
    );
  }
  return cryptoObj.subtle;
}

function getIndexedDB(): IDBFactory {
  const idb =
    (typeof window !== "undefined" && window.indexedDB) ||
    (typeof globalThis !== "undefined" && (globalThis as any).indexedDB);

  if (!idb) {
    throw new Error(
      "[E2EE] IndexedDB is not available in this browser environment."
    );
  }
  return idb;
}

// ==========================================
// INDEXEDDB KEY STORAGE
// ==========================================

/**
 * Opens or initializes the dedicated IndexedDB keystore.
 */
function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDB();
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(`[E2EE] Failed to open IndexedDB: ${request.error?.message}`));
  });
}

/**
 * Saves a CryptoKeyPair to IndexedDB.
 * Modern browsers support storing native CryptoKey objects directly via structured cloning.
 */
async function saveKeyPairToDB(id: string, keyPair: KeyPairResult): Promise<void> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({
      id,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      createdAt: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new Error(`[E2EE] Failed to save keypair: ${request.error?.message}`));
  });
}

/**
 * Retrieves a stored CryptoKeyPair from IndexedDB.
 */
async function getKeyPairFromDB(id: string): Promise<KeyPairResult | null> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.publicKey && result.privateKey) {
        resolve({
          publicKey: result.publicKey,
          privateKey: result.privateKey,
        });
      } else {
        resolve(null);
      }
    };
    request.onerror = () =>
      reject(new Error(`[E2EE] Failed to get keypair: ${request.error?.message}`));
  });
}

/**
 * Deletes all stored identity keys from IndexedDB (e.g. on account deletion / logout).
 */
export async function clearIdentityKeys(): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const db = await openKeyDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(IDENTITY_KEY_ID);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`[E2EE] Failed to delete keypair: ${request.error?.message}`));
    });
  } catch (err) {
    console.warn("[E2EE] Could not clear keys from IndexedDB:", err);
  }
}

// ==========================================
// CORE CRYPTOGRAPHIC PRIMITIVES
// ==========================================

/**
 * Generates an ECDH P-256 keypair.
 * @param extractable Whether the private key can be exported. Defaults to `false` for security.
 */
export async function generateECDHKeyPair(extractable = false): Promise<KeyPairResult> {
  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    extractable,
    ["deriveKey", "deriveBits"]
  );

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/**
 * Retrieves the stored identity keypair from IndexedDB WITHOUT generating a new one.
 * Returns null if no keypair exists in IndexedDB.
 */
export async function getStoredIdentityKeyPair(): Promise<KeyPairResult | null> {
  if (typeof window === "undefined" && typeof (globalThis as any).indexedDB === "undefined") {
    return null;
  }
  try {
    return await getKeyPairFromDB(IDENTITY_KEY_ID);
  } catch (e) {
    console.warn("[E2EE] Could not read stored identity keypair:", e);
    return null;
  }
}

/**
 * Result of the identity key lifecycle sync operation.
 */
export type KeyLifecycleResult =
  | { status: "ready"; publicKey: string }
  | { status: "registered"; publicKey: string }
  | { status: "key_mismatch"; localPublicKey: string; serverPublicKey: string }
  | { status: "key_loss"; serverPublicKey: string }
  | { status: "error"; message: string };

/**
 * Enforces the exact Phase 2 Key Lifecycle State Table with Public-Key Match Hardening:
 *
 * | SERVER KEY | LOCAL KEY | MATCH CHECK | ACTION
 * |------------|-----------|-------------|---------------------------------------------------------
 * | null       | null      | N/A         | Generate keypair -> store locally -> register public key
 * | null       | exists    | N/A         | Keep local key -> register its public key
 * | exists     | exists    | MATCH       | Verified: status = "ready" -> do not replace server key
 * | exists     | exists    | MISMATCH    | SECURITY VIOLATION: status = "key_mismatch" -> DO NOT overwrite
 * | exists     | null      | N/A         | KEY LOSS -> do not generate/register replacement automatically
 *
 * @param serverPublicKey The current user's publicKey as reported by the backend (or null)
 * @param token The authenticated user's session token
 * @param backendUrl The backend API base URL
 */
export async function syncIdentityKeyLifecycle(
  serverPublicKey: string | null | undefined,
  token: string,
  backendUrl: string
): Promise<KeyLifecycleResult> {
  try {
    const localKeyPair = await getStoredIdentityKeyPair();

    // CASE 4: Server has public key, but local IndexedDB is missing -> KEY LOSS!
    if (serverPublicKey && !localKeyPair) {
      console.warn(
        "[E2EE Security] Key Loss detected: Server has registered public key, but local device lacks private key. Aborting automatic replacement to protect historical message recovery."
      );
      return { status: "key_loss", serverPublicKey };
    }

    // CASE 3: Server has public key AND local key exists -> Cryptographic Match Verification!
    if (serverPublicKey && localKeyPair) {
      // Export ONLY the public key to compare with the server's public key
      const localPublicBase64 = await exportPublicKey(localKeyPair.publicKey);

      if (localPublicBase64 === serverPublicKey.trim()) {
        // MATCH: The local keypair corresponds directly to the identity on the server
        return { status: "ready", publicKey: localPublicBase64 };
      } else {
        // MISMATCH: Local keypair does NOT match the registered server identity key!
        console.error(
          "[E2EE Security] Key Mismatch detected! Local identity public key does not match server registered public key. Aborting identity operations without overwriting."
        );
        return {
          status: "key_mismatch",
          localPublicKey: localPublicBase64,
          serverPublicKey: serverPublicKey.trim(),
        };
      }
    }

    // CASE 1 & 2: Server has null public key
    let keyPairToRegister = localKeyPair;
    if (!keyPairToRegister) {
      // CASE 1: Generate fresh non-extractable keypair and store in IndexedDB
      keyPairToRegister = await getOrCreateIdentityKeyPair();
    }

    const publicBase64 = await exportPublicKey(keyPairToRegister.publicKey);

    // Register ONLY the public key via PUT /users/me/public-key
    const res = await fetch(`${backendUrl}/users/me/public-key`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ publicKey: publicBase64 }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || "Failed to register public key with server");
    }

    return { status: "registered", publicKey: publicBase64 };
  } catch (err: any) {
    console.error("[E2EE] Error syncing identity key lifecycle:", err);
    return { status: "error", message: err.message || "Unknown key sync error" };
  }
}

/**
 * Gets or creates the local persistent identity keypair in IndexedDB.
 * The private key is non-extractable, safeguarding it from memory extraction and XSS export.
 */
export async function getOrCreateIdentityKeyPair(): Promise<KeyPairResult> {
  try {
    const existing = await getKeyPairFromDB(IDENTITY_KEY_ID);
    if (existing) {
      return existing;
    }
  } catch (e) {
    console.warn("[E2EE] Could not retrieve existing keypair from IndexedDB, creating fresh pair:", e);
  }

  // Generate new non-extractable ECDH key pair
  const newKeyPair = await generateECDHKeyPair(false);

  try {
    await saveKeyPairToDB(IDENTITY_KEY_ID, newKeyPair);
  } catch (e) {
    console.warn("[E2EE] Failed to persist keypair to IndexedDB, continuing in-memory:", e);
  }

  return newKeyPair;
}

/**
 * Exports a public key to a transport-safe Base64 SPKI string.
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const subtle = getSubtleCrypto();
  const exported = await subtle.exportKey("spki", key);
  return arrayBufferToBase64(exported);
}

/**
 * Imports a remote public key from a Base64 SPKI string.
 */
export async function importPublicKey(base64Spki: string): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const keyBuffer = base64ToArrayBuffer(base64Spki);
  return await subtle.importKey(
    "spki",
    keyBuffer,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
}

/**
 * Derives a 256-bit AES-GCM symmetric key from our private ECDH key and peer's public ECDH key
 * using HKDF with SHA-256 for cryptographic expansion and domain separation.
 *
 * @param privateKey Our private ECDH key
 * @param peerPublicKey The other participant's public ECDH key
 * @param info Optional context/domain separation string (e.g. "chirp-chat-v1")
 */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  info: string = "chirp-e2ee-v1"
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();

  // 1. Derive shared secret bits using ECDH
  const sharedBits = await subtle.deriveBits(
    {
      name: "ECDH",
      public: peerPublicKey,
    },
    privateKey,
    256
  );

  // 2. Import derived bits as raw key material for HKDF
  const hkdfKey = await subtle.importKey(
    "raw",
    sharedBits,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  const encoder = new TextEncoder();
  const infoBytes = encoder.encode(info);
  // Optional salt: standard 32-byte zero salt for HKDF when dynamic salt is not pre-negotiated
  const salt = new Uint8Array(32);

  // 3. Derive 256-bit AES-GCM encryption key via HKDF-SHA-256
  return await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: infoBytes,
    },
    hkdfKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts plaintext using AES-256-GCM with a fresh cryptographically random 12-byte IV.
 *
 * AAD (Additional Authenticated Data) Note:
 * When provided, `additionalData` is authenticated alongside the ciphertext by the GCM auth tag,
 * guaranteeing that ciphertext cannot be copied into another room/chat without decryption failure.
 *
 * @param plaintext The message text to encrypt
 * @param key The derived AES-GCM CryptoKey
 * @param additionalData Optional string context to bind to the ciphertext (e.g., `${chatId}:${senderId}`)
 */
export async function encryptMessage(
  plaintext: string,
  key: CryptoKey,
  additionalData?: string
): Promise<EncryptedPayload> {
  const subtle = getSubtleCrypto();

  // Cryptographically random 12-byte IV for every single message
  const iv = getRandomBytes(12);

  const encoder = new TextEncoder();
  const encodedPlaintext = encoder.encode(plaintext);

  const gcmParams: AesGcmParams = {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
  };

  if (additionalData) {
    gcmParams.additionalData = encoder.encode(additionalData);
  }

  const ciphertextBuffer = await subtle.encrypt(
    gcmParams,
    key,
    encodedPlaintext
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv),
  };
}

/**
 * Decrypts AES-256-GCM ciphertext using the derived shared key and the 12-byte IV.
 *
 * @param payload The encrypted payload containing ciphertext and iv
 * @param key The derived AES-GCM CryptoKey
 * @param additionalData Optional AAD string that was used during encryption
 */
export async function decryptMessage(
  payload: EncryptedPayload,
  key: CryptoKey,
  additionalData?: string
): Promise<string> {
  const subtle = getSubtleCrypto();

  const ciphertext = base64ToArrayBuffer(payload.ciphertext);
  const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));

  const gcmParams: AesGcmParams = {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
  };

  if (additionalData) {
    const encoder = new TextEncoder();
    gcmParams.additionalData = encoder.encode(additionalData);
  }

  const decryptedBuffer = await subtle.decrypt(
    gcmParams,
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

// ==========================================
// CRYPTO SELF-TEST (VERIFICATION SUITE)
// ==========================================

/**
 * Runs a complete cryptographic self-test in the current browser environment:
 * 1. Generates Alice ECDH keypair
 * 2. Generates Bob ECDH keypair
 * 3. Exports/imports public keys to verify SPKI transport encoding
 * 4. Derives shared keys on both sides and verifies symmetric key equality
 * 5. Encrypts "Hello Chirp" with Alice's key
 * 6. Decrypts with Bob's key and asserts plaintext equality
 * 7. Verifies tampering rejection on altered ciphertext
 * 8. Verifies tampering rejection on altered IV
 * 9. Verifies AAD authentication binding
 */
export async function runCryptoSelfTest(): Promise<{
  success: boolean;
  message: string;
  details: Record<string, boolean>;
}> {
  const details: Record<string, boolean> = {
    aliceKeyPairGenerated: false,
    bobKeyPairGenerated: false,
    spkiExportImportAlice: false,
    spkiExportImportBob: false,
    sharedKeyDerivedBothSides: false,
    encryptionSuccessful: false,
    decryptionSuccessful: false,
    tamperedCiphertextRejected: false,
    tamperedIVRejected: false,
    aadBindingVerified: false,
  };

  try {
    // 1. Generate key pairs
    const alicePair = await generateECDHKeyPair(true);
    details.aliceKeyPairGenerated = Boolean(alicePair.publicKey && alicePair.privateKey);

    const bobPair = await generateECDHKeyPair(true);
    details.bobKeyPairGenerated = Boolean(bobPair.publicKey && bobPair.privateKey);

    // 2. Export & Import public keys
    const alicePublicSpki = await exportPublicKey(alicePair.publicKey);
    const aliceImportedPublic = await importPublicKey(alicePublicSpki);
    details.spkiExportImportAlice = Boolean(aliceImportedPublic);

    const bobPublicSpki = await exportPublicKey(bobPair.publicKey);
    const bobImportedPublic = await importPublicKey(bobPublicSpki);
    details.spkiExportImportBob = Boolean(bobImportedPublic);

    // 3. Derive shared key on both sides
    const aliceDerivedKey = await deriveSharedKey(alicePair.privateKey, bobImportedPublic);
    const bobDerivedKey = await deriveSharedKey(bobPair.privateKey, aliceImportedPublic);
    details.sharedKeyDerivedBothSides = Boolean(aliceDerivedKey && bobDerivedKey);

    // 4. Encrypt test message with Alice's key
    const testPlaintext = "Hello Chirp";
    const encrypted = await encryptMessage(testPlaintext, aliceDerivedKey);
    details.encryptionSuccessful = Boolean(encrypted.ciphertext && encrypted.iv);

    // 5. Decrypt with Bob's key
    const decrypted = await decryptMessage(encrypted, bobDerivedKey);
    details.decryptionSuccessful = decrypted === testPlaintext;
    if (!details.decryptionSuccessful) {
      throw new Error("Decrypted text does not match original plaintext");
    }

    // 6. Verify tampered ciphertext rejection
    let ciphertextTamperFailed = false;
    try {
      const tamperedBytes = new Uint8Array(base64ToArrayBuffer(encrypted.ciphertext));
      tamperedBytes[0] ^= 0xff; // Flip bits
      const tamperedPayload: EncryptedPayload = {
        ciphertext: arrayBufferToBase64(tamperedBytes),
        iv: encrypted.iv,
      };
      await decryptMessage(tamperedPayload, bobDerivedKey);
    } catch {
      // Expected cryptographic authentication error
      ciphertextTamperFailed = true;
    }
    details.tamperedCiphertextRejected = ciphertextTamperFailed;

    // 7. Verify tampered IV rejection
    let ivTamperFailed = false;
    try {
      const tamperedIvBytes = new Uint8Array(base64ToArrayBuffer(encrypted.iv));
      tamperedIvBytes[0] ^= 0xff; // Flip bits
      const tamperedPayload: EncryptedPayload = {
        ciphertext: encrypted.ciphertext,
        iv: arrayBufferToBase64(tamperedIvBytes),
      };
      await decryptMessage(tamperedPayload, bobDerivedKey);
    } catch {
      // Expected authentication error
      ivTamperFailed = true;
    }
    details.tamperedIVRejected = ivTamperFailed;

    // 8. Verify AAD (Additional Authenticated Data) binding
    const contextAAD = "chat:123:user:456";
    const encryptedWithAAD = await encryptMessage(testPlaintext, aliceDerivedKey, contextAAD);
    const decryptedWithAAD = await decryptMessage(encryptedWithAAD, bobDerivedKey, contextAAD);
    let wrongAadRejected = false;
    try {
      await decryptMessage(encryptedWithAAD, bobDerivedKey, "chat:999:user:000");
    } catch {
      wrongAadRejected = true;
    }
    details.aadBindingVerified = decryptedWithAAD === testPlaintext && wrongAadRejected;

    const allPassed = Object.values(details).every(Boolean);

    return {
      success: allPassed,
      message: allPassed
        ? "All E2EE cryptographic checks passed successfully."
        : "One or more cryptographic checks failed.",
      details,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Crypto self-test failed: ${err.message}`,
      details,
    };
  }
}

// ==========================================
// PHASE 3 STEP 1: E2EE MESSAGE PROTOCOL & ENVELOPE
// ==========================================

export type E2EEMessageEnvelope = {
  e2ee: true;
  v: 1;
  iv: string; // Base64 representation of exactly 12-byte IV
  ct: string; // Base64 ciphertext + GCM auth tag
};

/**
 * Strict type-guard to validate an untrusted value as a genuine E2EEMessageEnvelope.
 *
 * Requirements:
 * - value is a non-null object
 * - value.e2ee is boolean true
 * - value.v is number 1
 * - value.iv is valid Base64 decoding to exactly 12 bytes
 * - value.ct is valid Base64 non-empty string
 */
export function isE2EEMessageEnvelope(value: unknown): value is E2EEMessageEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.e2ee !== true || candidate.v !== 1) {
    return false;
  }

  if (typeof candidate.iv !== "string" || typeof candidate.ct !== "string") {
    return false;
  }

  if (candidate.ct.length === 0) {
    return false;
  }

  // Validate IV Base64 format and length
  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64Regex.test(candidate.iv) || !base64Regex.test(candidate.ct)) {
    return false;
  }

  try {
    const ivBytes = new Uint8Array(base64ToArrayBuffer(candidate.iv));
    if (ivBytes.byteLength !== 12) {
      return false;
    }
  } catch {
    return false;
  }

  // Ensure Base64 decoding of ct succeeds
  try {
    const ctBytes = new Uint8Array(base64ToArrayBuffer(candidate.ct));
    if (ctBytes.byteLength === 0) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Serializes a validated E2EEMessageEnvelope into a compact, deterministic JSON string.
 */
export function packE2EEMessage(envelope: E2EEMessageEnvelope): string {
  if (!isE2EEMessageEnvelope(envelope)) {
    throw new Error("[E2EE] Invalid envelope cannot be packed.");
  }
  return JSON.stringify({
    e2ee: envelope.e2ee,
    v: envelope.v,
    iv: envelope.iv,
    ct: envelope.ct,
  });
}

/**
 * Deserializes and strictly validates a raw JSON string into an E2EEMessageEnvelope.
 * Never throws on untrusted/malformed inputs; returns null on any validation failure.
 */
export function unpackE2EEMessage(raw: string): E2EEMessageEnvelope | null {
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (isE2EEMessageEnvelope(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ==========================================
// IN-MEMORY CONVERSATION KEY CACHE
// ==========================================

/**
 * Ephemeral in-memory cache for derived pairwise conversation keys.
 *
 * Security guarantees:
 * - Cache key binds BOTH conversation ID and peer public key.
 * - Never persisted to IndexedDB, localStorage, or sessionStorage.
 * - Never logged or transmitted over network.
 * - Can be wiped at any time via clearConversationKeyCache().
 */
const conversationKeyCache = new Map<string, CryptoKey>();

export function clearConversationKeyCache(): void {
  conversationKeyCache.clear();
}

/**
 * Derives a pairwise AES-256-GCM symmetric key for a specific conversation.
 *
 * HKDF Info Context:
 * "chirp:e2ee:v1:conversation:<chatId>"
 *
 * Binds the derived key strictly to the specific chat/conversation identifier,
 * preventing cross-conversation ciphertext transplantation.
 */
export async function getConversationSharedKey(
  chatId: string,
  peerPublicKeyBase64: string
): Promise<CryptoKey> {
  if (!chatId || typeof chatId !== "string") {
    throw new Error("[E2EE] Invalid chatId provided for key derivation.");
  }
  if (!peerPublicKeyBase64 || typeof peerPublicKeyBase64 !== "string") {
    throw new Error("[E2EE] Invalid peerPublicKeyBase64 provided for key derivation.");
  }

  const normalizedPeerKey = peerPublicKeyBase64.trim();
  const cacheKey = `${chatId}::${normalizedPeerKey}`;

  const cachedKey = conversationKeyCache.get(cacheKey);
  if (cachedKey) {
    return cachedKey;
  }

  // 1. Retrieve local identity keypair from IndexedDB
  const localKeyPair = await getStoredIdentityKeyPair();
  if (!localKeyPair || !localKeyPair.privateKey) {
    throw new Error(
      "[E2EE] Local identity keypair is missing. Cannot derive conversation key."
    );
  }

  // 2. Import peer public key
  const peerPublicKey = await importPublicKey(normalizedPeerKey);

  // 3. Derive domain-separated shared AES key
  const info = `chirp:e2ee:v1:conversation:${chatId}`;
  const derivedKey = await deriveSharedKey(localKeyPair.privateKey, peerPublicKey, info);

  // 4. Cache in memory
  conversationKeyCache.set(cacheKey, derivedKey);
  return derivedKey;
}

// ==========================================
// HIGH-LEVEL ENCRYPT / DECRYPT HELPERS
// ==========================================

/**
 * Constructs the standard AAD (Additional Authenticated Data) for a message.
 *
 * Format: "chirp:e2ee:v1:message:<chatId>:<senderId>"
 */
export function buildMessageAAD(chatId: string, senderId: string): string {
  return `chirp:e2ee:v1:message:${chatId}:${senderId}`;
}

/**
 * Encrypts a text message using the derived conversation key, a fresh 12-byte IV,
 * and authenticated AAD binding to chatId and senderId.
 *
 * Returns the serialized E2EEMessageEnvelope JSON string.
 */
export async function encryptTextMessage(
  plaintext: string,
  chatId: string,
  senderId: string,
  peerPublicKeyBase64: string
): Promise<string> {
  if (typeof plaintext !== "string") {
    throw new Error("[E2EE] Plaintext must be a string.");
  }
  if (!chatId || !senderId) {
    throw new Error("[E2EE] Both chatId and senderId are required for AAD binding.");
  }

  // 1. Obtain conversation AES key
  const conversationKey = await getConversationSharedKey(chatId, peerPublicKeyBase64);

  // 2. Construct AAD
  const aad = buildMessageAAD(chatId, senderId);

  // 3. Encrypt plaintext with AES-256-GCM (generates fresh random 12-byte IV)
  const encrypted = await encryptMessage(plaintext, conversationKey, aad);

  // 4. Construct typed envelope
  const envelope: E2EEMessageEnvelope = {
    e2ee: true,
    v: 1,
    iv: encrypted.iv,
    ct: encrypted.ciphertext,
  };

  // 5. Return compact serialized envelope
  return packE2EEMessage(envelope);
}

/**
 * Decrypts a serialized E2EEMessageEnvelope string using the derived conversation key
 * and verifies authentication with the exact expected AAD.
 *
 * Throws a cryptographic error if authentication fails, envelope is invalid,
 * or if ciphertext/IV/AAD were tampered with. Never returns ciphertext as fallback.
 */
export async function decryptTextMessage(
  rawEnvelope: string,
  chatId: string,
  senderId: string,
  peerPublicKeyBase64: string
): Promise<string> {
  // 1. Parse and strictly validate envelope
  const envelope = unpackE2EEMessage(rawEnvelope);
  if (!envelope) {
    throw new Error("[E2EE] Invalid or malformed E2EE message envelope.");
  }

  // 2. Obtain conversation AES key
  const conversationKey = await getConversationSharedKey(chatId, peerPublicKeyBase64);

  // 3. Construct exact AAD
  const aad = buildMessageAAD(chatId, senderId);

  // 4. Decrypt via AES-GCM (Web Crypto rejects tampered ciphertext or wrong AAD)
  return await decryptMessage(
    {
      ciphertext: envelope.ct,
      iv: envelope.iv,
    },
    conversationKey,
    aad
  );
}

// ==========================================
// PHASE 4 STEP 1: E2EE MEDIA CRYPTO LAYER
// ==========================================

export type E2EEMediaType = "image" | "audio";

export type E2EEMediaV1Envelope = {
  e2ee: true;
  v: 1;
  type: E2EEMediaType;
  mime: string;
  iv: string;
  ct: string;
};

export type E2EEMediaV2Envelope = {
  e2ee: true;
  v: 2;
  type: E2EEMediaType;
  mediaId: string;
  storageKey: string;
  mime: string;
  iv: string;
  fileSize: number;
};

export type E2EEMediaEnvelope = E2EEMediaV1Envelope | E2EEMediaV2Envelope;

/**
 * Maximum image size in bytes allowed for client-side E2EE photo encryption (5.5 MB).
 * Kept safely below backend's 8 MB Base64 ciphertext limit (MAX_MEDIA_CIPHERTEXT_SIZE),
 * accounting for AES-GCM tag (16 bytes) and Base64 expansion (4/3 factor: 5.5MB * 1.333 ≈ 7.33MB < 8MB).
 */
export const MAX_E2EE_IMAGE_BYTES = 5.5 * 1024 * 1024; // 5.5 MB (5,767,168 bytes)

/**
 * Maximum audio size in bytes allowed for client-side E2EE voice recording encryption (5.5 MB).
 * Safely conforms to the backend's 8 MB Base64 ciphertext limit (MAX_MEDIA_CIPHERTEXT_SIZE).
 */
export const MAX_E2EE_AUDIO_BYTES = 5.5 * 1024 * 1024; // 5.5 MB (5,767,168 bytes)

/**
 * Maximum recording duration in seconds for voice notes (120 seconds = 2 minutes).
 */
export const MAX_VOICE_DURATION_SECONDS = 120; // 2 minutes

/**
 * Validates whether an unknown value conforms to the versioned E2EEMediaEnvelope specification.
 *
 * Requirements:
 * - e2ee === true
 * - v === 1
 * - type === "image" OR type === "audio"
 * - mime is a non-empty string starting with "image/" or "audio/"
 * - iv is valid Base64 and decodes to exactly 12 bytes
 * - ct is valid Base64 and is non-empty
 */
export function isE2EEMediaV1Envelope(value: unknown): value is E2EEMediaV1Envelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.e2ee !== true || candidate.v !== 1) {
    return false;
  }

  if (candidate.type !== "image" && candidate.type !== "audio") {
    return false;
  }

  if (
    typeof candidate.mime !== "string" ||
    candidate.mime.trim().length === 0 ||
    (!candidate.mime.startsWith("image/") && !candidate.mime.startsWith("audio/"))
  ) {
    return false;
  }

  if (typeof candidate.iv !== "string" || typeof candidate.ct !== "string") {
    return false;
  }

  if (candidate.ct.length === 0) {
    return false;
  }

  // Validate Base64 formatting
  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64Regex.test(candidate.iv) || !base64Regex.test(candidate.ct)) {
    return false;
  }

  try {
    const ivBytes = new Uint8Array(base64ToArrayBuffer(candidate.iv));
    if (ivBytes.byteLength !== 12) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const ctBytes = new Uint8Array(base64ToArrayBuffer(candidate.ct));
    if (ctBytes.byteLength === 0) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

export function isE2EEMediaV2Envelope(value: unknown): value is E2EEMediaV2Envelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.e2ee !== true || candidate.v !== 2) {
    return false;
  }

  if (candidate.type !== "image" && candidate.type !== "audio") {
    return false;
  }

  if (
    typeof candidate.mediaId !== "string" ||
    candidate.mediaId.trim().length === 0 ||
    typeof candidate.storageKey !== "string" ||
    candidate.storageKey.trim().length === 0
  ) {
    return false;
  }

  if (
    typeof candidate.mime !== "string" ||
    candidate.mime.trim().length === 0 ||
    (!candidate.mime.startsWith("image/") && !candidate.mime.startsWith("audio/"))
  ) {
    return false;
  }

  if (typeof candidate.iv !== "string") {
    return false;
  }

  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64Regex.test(candidate.iv)) {
    return false;
  }

  try {
    const ivBytes = new Uint8Array(base64ToArrayBuffer(candidate.iv));
    if (ivBytes.byteLength !== 12) {
      return false;
    }
  } catch {
    return false;
  }

  if (typeof candidate.fileSize !== "number" || candidate.fileSize <= 0) {
    return false;
  }

  return true;
}

/**
 * Validates whether an unknown value conforms to the versioned E2EEMediaEnvelope specification (v1 or v2).
 */
export function isE2EEMediaEnvelope(value: unknown): value is E2EEMediaEnvelope {
  return isE2EEMediaV1Envelope(value) || isE2EEMediaV2Envelope(value);
}

/**
 * Serializes a validated E2EEMediaEnvelope into a deterministic JSON string.
 */
export function packE2EEMedia(envelope: E2EEMediaEnvelope): string {
  if (isE2EEMediaV1Envelope(envelope)) {
    return JSON.stringify({
      e2ee: envelope.e2ee,
      v: envelope.v,
      type: envelope.type,
      mime: envelope.mime,
      iv: envelope.iv,
      ct: envelope.ct,
    });
  }
  if (isE2EEMediaV2Envelope(envelope)) {
    return JSON.stringify({
      e2ee: envelope.e2ee,
      v: envelope.v,
      type: envelope.type,
      mediaId: envelope.mediaId,
      storageKey: envelope.storageKey,
      mime: envelope.mime,
      iv: envelope.iv,
      fileSize: envelope.fileSize,
    });
  }
  throw new Error("[E2EE] Invalid media envelope cannot be packed.");
}

/**
 * Deserializes and strictly validates a raw JSON string or unknown object into an E2EEMediaEnvelope.
 * Returns null on any validation failure or parsing error.
 */
export function unpackE2EEMedia(value: string | unknown): E2EEMediaEnvelope | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    if (!value.trim().startsWith("{")) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      if (isE2EEMediaEnvelope(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    if (isE2EEMediaEnvelope(value)) {
      return value;
    }
    return null;
  }

  return null;
}

/**
 * Constructs media-specific AAD (Additional Authenticated Data).
 *
 * Format: "chirp:e2ee:v1:media:<chatId>:<senderId>:<type>:<mime>"
 * Example: "chirp:e2ee:v1:media:chat123:user456:image:image/jpeg"
 */
export function buildMediaAAD(
  chatId: string,
  senderId: string,
  type: E2EEMediaType,
  mime: string
): string {
  return `chirp:e2ee:v1:media:${chatId}:${senderId}:${type}:${mime}`;
}

/**
 * Encrypts a raw media Blob directly to binary ArrayBuffer without Base64 encoding.
 * Used for direct binary upload to Backblaze B2 (Phase 2).
 */
export async function encryptMediaBlobToBinary(
  blob: Blob,
  chatId: string,
  senderId: string,
  peerPublicKey: string,
  type: E2EEMediaType
): Promise<{
  rawEncryptedBytes: ArrayBuffer;
  iv: string;
  mime: string;
  fileSize: number;
}> {
  if (!blob || typeof blob.arrayBuffer !== "function") {
    throw new Error("[E2EE] Invalid blob provided for media encryption.");
  }
  if (!chatId || typeof chatId !== "string") {
    throw new Error("[E2EE] Invalid chatId provided for media encryption.");
  }
  if (!senderId || typeof senderId !== "string") {
    throw new Error("[E2EE] Invalid senderId provided for media encryption.");
  }
  if (!peerPublicKey || typeof peerPublicKey !== "string") {
    throw new Error("[E2EE] Invalid peerPublicKey provided for media encryption.");
  }
  if (type !== "image" && type !== "audio") {
    throw new Error(`[E2EE] Unsupported media type: ${type}`);
  }

  const mime = blob.type;
  if (
    !mime ||
    typeof mime !== "string" ||
    (!mime.startsWith("image/") && !mime.startsWith("audio/"))
  ) {
    throw new Error(
      `[E2EE] Invalid or unsupported media MIME type on blob: "${mime}". Must start with "image/" or "audio/".`
    );
  }

  // 1. Obtain conversation shared AES key
  const conversationKey = await getConversationSharedKey(chatId, peerPublicKey);

  // 2. Read raw media bytes
  const rawBytes = await blob.arrayBuffer();

  // 3. Generate fresh random 12-byte IV for every encryption
  const iv = getRandomBytes(12);

  // 4. Construct media-specific AAD
  const aad = buildMediaAAD(chatId, senderId, type, mime);
  const encoder = new TextEncoder();

  const gcmParams: AesGcmParams = {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
    additionalData: encoder.encode(aad),
  };

  // 5. Encrypt with AES-256-GCM
  const subtle = getSubtleCrypto();
  const rawEncryptedBytes = await subtle.encrypt(gcmParams, conversationKey, rawBytes);

  return {
    rawEncryptedBytes,
    iv: arrayBufferToBase64(iv),
    mime,
    fileSize: blob.size,
  };
}

/**
 * Decrypts raw encrypted binary ArrayBuffer using AES-256-GCM and media AAD.
 */
export async function decryptMediaRawBytes(
  rawEncryptedBytes: ArrayBuffer,
  ivBase64: string,
  mime: string,
  type: E2EEMediaType,
  chatId: string,
  senderId: string,
  peerPublicKey: string
): Promise<Blob> {
  if (!rawEncryptedBytes || rawEncryptedBytes.byteLength === 0) {
    throw new Error("[E2EE] Empty encrypted bytes provided for media decryption.");
  }
  if (!chatId || typeof chatId !== "string") {
    throw new Error("[E2EE] Invalid chatId provided for media decryption.");
  }
  if (!senderId || typeof senderId !== "string") {
    throw new Error("[E2EE] Invalid senderId provided for media decryption.");
  }
  if (!peerPublicKey || typeof peerPublicKey !== "string") {
    throw new Error("[E2EE] Invalid peerPublicKey provided for media decryption.");
  }

  // 1. Obtain conversation shared AES key
  const conversationKey = await getConversationSharedKey(chatId, peerPublicKey);

  // 2. Decode IV
  const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));

  // 3. Construct media-specific AAD
  const aad = buildMediaAAD(chatId, senderId, type, mime);
  const encoder = new TextEncoder();

  const gcmParams: AesGcmParams = {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
    additionalData: encoder.encode(aad),
  };

  // 4. AES-256-GCM decrypt (throws OperationError if auth fails or data tampered)
  const subtle = getSubtleCrypto();
  const decryptedBuffer = await subtle.decrypt(gcmParams, conversationKey, rawEncryptedBytes);

  return new Blob([decryptedBuffer], {
    type: mime,
  });
}

/**
 * Encrypts a raw media Blob using AES-256-GCM with a fresh 12-byte IV,
 * bound cryptographically to chatId, senderId, type, and mime via AAD.
 *
 * Returns an E2EEMediaV1Envelope (inline Base64 ciphertext).
 */
export async function encryptMediaBlob(
  blob: Blob,
  chatId: string,
  senderId: string,
  peerPublicKey: string,
  type: E2EEMediaType
): Promise<E2EEMediaEnvelope> {
  const { rawEncryptedBytes, iv, mime } = await encryptMediaBlobToBinary(
    blob,
    chatId,
    senderId,
    peerPublicKey,
    type
  );

  const envelope: E2EEMediaV1Envelope = {
    e2ee: true,
    v: 1,
    type,
    mime,
    iv,
    ct: arrayBufferToBase64(rawEncryptedBytes),
  };

  if (!isE2EEMediaV1Envelope(envelope)) {
    throw new Error("[E2EE] Internal error: Generated media envelope failed validation.");
  }

  return envelope;
}

/**
 * Decrypts a v1 inline E2EEMediaEnvelope using the derived conversation key,
 * verifying that the ciphertext, IV, chatId, senderId, type, and MIME match exactly.
 *
 * Returns a Blob containing decrypted plaintext bytes with envelope.mime type.
 */
export async function decryptMediaEnvelope(
  envelope: E2EEMediaEnvelope,
  chatId: string,
  senderId: string,
  peerPublicKey: string
): Promise<Blob> {
  // 1. Validate envelope
  if (!isE2EEMediaEnvelope(envelope)) {
    throw new Error("[E2EE] Malformed or invalid E2EE media envelope.");
  }
  if (envelope.v !== 1) {
    throw new Error("[E2EE] decryptMediaEnvelope only decrypts v1 inline envelopes. For v2, download ciphertext and use decryptMediaRawBytes.");
  }

  const ciphertextBuffer = base64ToArrayBuffer(envelope.ct);
  return await decryptMediaRawBytes(
    ciphertextBuffer,
    envelope.iv,
    envelope.mime,
    envelope.type,
    chatId,
    senderId,
    peerPublicKey
  );
}


