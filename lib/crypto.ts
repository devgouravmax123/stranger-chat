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
