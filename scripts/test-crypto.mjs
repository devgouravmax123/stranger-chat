import {
  runCryptoSelfTest,
  generateECDHKeyPair,
  exportPublicKey,
  syncIdentityKeyLifecycle,
} from "../lib/crypto.ts";

console.log("Starting E2EE Cryptographic & Lifecycle Test Suite...\n");

async function runAllTests() {
  // Test 1: Web Crypto Primitives (Diffie-Hellman, AES-GCM, AAD, Tamper Resistance)
  console.log("1. Running Web Crypto Self-Test...");
  const selfTestRes = await runCryptoSelfTest();
  console.log("   Self-test success:", selfTestRes.success);
  if (!selfTestRes.success) {
    throw new Error(`Self-test failed: ${selfTestRes.message}`);
  }

  // Set up mock IndexedDB for Node.js environment to test lifecycle states
  let mockStore = new Map();
  const mockIDB = {
    open: (name, version) => {
      const req = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              get: (id) => {
                const getReq = { onsuccess: null, onerror: null, result: mockStore.get(id) || null };
                setTimeout(() => getReq.onsuccess?.(), 0);
                return getReq;
              },
              put: (item) => {
                mockStore.set(item.id, item);
                const putReq = { onsuccess: null, onerror: null };
                setTimeout(() => putReq.onsuccess?.(), 0);
                return putReq;
              },
              delete: (id) => {
                mockStore.delete(id);
                const delReq = { onsuccess: null, onerror: null };
                setTimeout(() => delReq.onsuccess?.(), 0);
                return delReq;
              },
            }),
          }),
        },
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
  globalThis.indexedDB = mockIDB;

  // Mock server registration endpoint
  let serverRegisteredKey = null;
  let serverPutCalls = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.endsWith("/users/me/public-key") && opts.method === "PUT") {
      serverPutCalls++;
      const body = JSON.parse(opts.body);
      serverRegisteredKey = body.publicKey;
      return { ok: true, json: async () => ({ id: "user-1", publicKey: serverRegisteredKey }) };
    }
    return { ok: false, status: 404 };
  };

  console.log("\n2. Testing Phase 2 Lifecycle State Matrix:");

  // A. Both null -> Generates new keypair, stores locally, and registers with server
  mockStore.clear();
  serverRegisteredKey = null;
  serverPutCalls = 0;
  const resBothNull = await syncIdentityKeyLifecycle(null, "mock-token", "https://api.chirp.test");
  console.log("   A. Server null + Local null ->", resBothNull.status);
  if (resBothNull.status !== "registered" || !resBothNull.publicKey || serverPutCalls !== 1) {
    throw new Error("Failed test A: Should generate and register new keypair");
  }

  // B. Matching local and server public keys -> Status "ready" (no server PUT call)
  serverPutCalls = 0;
  const resMatch = await syncIdentityKeyLifecycle(serverRegisteredKey, "mock-token", "https://api.chirp.test");
  console.log("   B. Server exists + Local exists + MATCH ->", resMatch.status);
  if (resMatch.status !== "ready" || resMatch.publicKey !== serverRegisteredKey || serverPutCalls !== 0) {
    throw new Error("Failed test B: Matching keys must return status 'ready' without overwriting");
  }

  // C. Different public keys -> Status "key_mismatch" (DO NOT overwrite server key)
  const anotherPair = await generateECDHKeyPair(true);
  const differentServerKey = await exportPublicKey(anotherPair.publicKey);
  serverPutCalls = 0;
  const resMismatch = await syncIdentityKeyLifecycle(differentServerKey, "mock-token", "https://api.chirp.test");
  console.log("   C. Server exists + Local exists + MISMATCH ->", resMismatch.status);
  if (resMismatch.status !== "key_mismatch" || serverPutCalls !== 0) {
    throw new Error("Failed test C: Mismatched keys must report 'key_mismatch' and NOT overwrite server key");
  }

  // D. Server key exists but local IndexedDB is missing -> Status "key_loss" (DO NOT generate/replace)
  mockStore.clear(); // Simulate user clearing site data
  serverPutCalls = 0;
  const resKeyLoss = await syncIdentityKeyLifecycle(differentServerKey, "mock-token", "https://api.chirp.test");
  console.log("   D. Server exists + Local missing ->", resKeyLoss.status);
  if (resKeyLoss.status !== "key_loss" || serverPutCalls !== 0 || mockStore.size !== 0) {
    throw new Error("Failed test D: Missing local key must report 'key_loss' and NOT overwrite server key");
  }

  // E. Server null + Local key exists -> Registers existing local key (no new keypair generated)
  mockStore.set("chirp_identity_keypair", {
    id: "chirp_identity_keypair",
    publicKey: anotherPair.publicKey,
    privateKey: anotherPair.privateKey,
  });
  serverPutCalls = 0;
  const resServerNullLocalExists = await syncIdentityKeyLifecycle(null, "mock-token", "https://api.chirp.test");
  console.log("   E. Server null + Local exists ->", resServerNullLocalExists.status);
  if (
    resServerNullLocalExists.status !== "registered" ||
    resServerNullLocalExists.publicKey !== differentServerKey ||
    serverPutCalls !== 1
  ) {
    throw new Error("Failed test E: Should register existing local key without replacing it");
  }

  console.log("\nAll 5 Phase 2 lifecycle states passed verification successfully!");

  // ==========================================
  // PHASE 3 STEP 1 TESTS: E2EE MESSAGING PROTOCOL & ENVELOPE
  // ==========================================
  console.log("\n3. Testing Phase 3 Step 1 E2EE Messaging Protocol & Envelope...");

  const {
    isE2EEMessageEnvelope,
    packE2EEMessage,
    unpackE2EEMessage,
    getConversationSharedKey,
    clearConversationKeyCache,
    encryptTextMessage,
    decryptTextMessage,
  } = await import("../lib/crypto.ts");

  // 1. Envelope validation & parsing checks
  console.log("   A. Envelope validation & rejection rules");
  const validEnvelope = {
    e2ee: true,
    v: 1,
    iv: "MTIzNDU2Nzg5MDEy", // exactly 12 bytes: "123456789012" in Base64
    ct: "c29tZS1jaXBoZXJ0ZXh0", // "some-ciphertext" in Base64
  };
  if (!isE2EEMessageEnvelope(validEnvelope)) {
    throw new Error("Valid envelope was rejected by isE2EEMessageEnvelope");
  }

  // Reject malformed envelopes
  if (isE2EEMessageEnvelope(null)) throw new Error("Accepted null envelope");
  if (isE2EEMessageEnvelope("string")) throw new Error("Accepted string envelope");
  if (isE2EEMessageEnvelope({ ...validEnvelope, e2ee: false })) throw new Error("Accepted e2ee: false");
  if (isE2EEMessageEnvelope({ ...validEnvelope, v: 2 })) throw new Error("Accepted unsupported version 2");
  if (isE2EEMessageEnvelope({ ...validEnvelope, iv: "short" })) throw new Error("Accepted non-12-byte IV");
  if (isE2EEMessageEnvelope({ ...validEnvelope, iv: "!@#$%" })) throw new Error("Accepted invalid Base64 IV");
  if (isE2EEMessageEnvelope({ ...validEnvelope, ct: "" })) throw new Error("Accepted empty ciphertext");
  if (isE2EEMessageEnvelope({ ...validEnvelope, ct: 12345 })) throw new Error("Accepted non-string ciphertext");

  const packed = packE2EEMessage(validEnvelope);
  const unpacked = unpackE2EEMessage(packed);
  if (!unpacked || unpacked.iv !== validEnvelope.iv || unpacked.ct !== validEnvelope.ct) {
    throw new Error("Failed pack/unpack roundtrip");
  }

  if (unpackE2EEMessage("{ invalid json") !== null) throw new Error("unpackE2EEMessage threw or parsed invalid JSON");
  if (unpackE2EEMessage("plain text message") !== null) throw new Error("unpackE2EEMessage parsed plain text");
  if (unpackE2EEMessage(JSON.stringify({ text: "legacy" })) !== null) throw new Error("unpackE2EEMessage parsed legacy object");

  console.log("      ✓ All envelope type-guards and unpack guards passed.");

  // 2. Pairwise Conversation Key Derivation & End-to-End Encryption
  console.log("   B. Two-party pairwise message encryption & decryption");
  const alicePair = await generateECDHKeyPair(true);
  const bobPair = await generateECDHKeyPair(true);
  const alicePublicBase64 = await exportPublicKey(alicePair.publicKey);
  const bobPublicBase64 = await exportPublicKey(bobPair.publicKey);

  // Setup Alice in mock IndexedDB
  mockStore.set("chirp_identity_keypair", {
    id: "chirp_identity_keypair",
    publicKey: alicePair.publicKey,
    privateKey: alicePair.privateKey,
  });

  const chatId = "chat-room-456";
  const senderId = "user-alice";

  // Test various message contents
  const testCases = [
    "hello",
    "hello again",
    "",
    "Hello 👋 世界! 🚀 🔒 E2EE test with multi-byte characters and symbols.",
    "A".repeat(5000), // long message
  ];

  for (const plaintext of testCases) {
    // Alice encrypts for Bob
    const encryptedRaw = await encryptTextMessage(plaintext, chatId, senderId, bobPublicBase64);
    const parsedEnv = unpackE2EEMessage(encryptedRaw);
    if (!parsedEnv) throw new Error("Produced invalid envelope string");

    // Bob decrypts Alice's message (switch local identity to Bob)
    mockStore.set("chirp_identity_keypair", {
      id: "chirp_identity_keypair",
      publicKey: bobPair.publicKey,
      privateKey: bobPair.privateKey,
    });
    clearConversationKeyCache(); // Clear cache to ensure Bob uses Bob's key

    const decrypted = await decryptTextMessage(encryptedRaw, chatId, senderId, alicePublicBase64);
    if (decrypted !== plaintext) {
      throw new Error(`Decrypted message mismatch! Expected '${plaintext}', got '${decrypted}'`);
    }

    // Switch back to Alice for next iteration
    mockStore.set("chirp_identity_keypair", {
      id: "chirp_identity_keypair",
      publicKey: alicePair.publicKey,
      privateKey: alicePair.privateKey,
    });
    clearConversationKeyCache();
  }
  console.log("      ✓ Successfully encrypted and decrypted normal, empty, unicode, and large messages.");

  // 3. Verify IV randomness and ciphertext variation
  console.log("   C. Nonce / IV uniqueness verification");
  const enc1 = await encryptTextMessage("Identical content", chatId, senderId, bobPublicBase64);
  const enc2 = await encryptTextMessage("Identical content", chatId, senderId, bobPublicBase64);
  const env1 = unpackE2EEMessage(enc1);
  const env2 = unpackE2EEMessage(enc2);

  if (env1.iv === env2.iv) throw new Error("Repeated IV across separate encryptions!");
  if (env1.ct === env2.ct) throw new Error("Identical ciphertext generated across separate encryptions!");
  console.log("      ✓ Each message receives distinct 12-byte IV and unique ciphertext.");

  // 4. Cryptographic Authentication & Tamper Rejection Checks
  console.log("   D. Cryptographic tamper & AAD mismatch rejection");

  // Bob as recipient
  mockStore.set("chirp_identity_keypair", {
    id: "chirp_identity_keypair",
    publicKey: bobPair.publicKey,
    privateKey: bobPair.privateKey,
  });
  clearConversationKeyCache();

  // D1. Tampered ciphertext rejection
  let tamperedCtRejected = false;
  try {
    const rawEnv = await encryptTextMessage("Authentic message", chatId, senderId, bobPublicBase64);
    const envObj = unpackE2EEMessage(rawEnv);
    const ctBytes = new Uint8Array(Buffer.from(envObj.ct, "base64"));
    ctBytes[0] ^= 0x01; // flip 1 bit
    envObj.ct = Buffer.from(ctBytes).toString("base64");
    await decryptTextMessage(packE2EEMessage(envObj), chatId, senderId, alicePublicBase64);
  } catch {
    tamperedCtRejected = true;
  }
  if (!tamperedCtRejected) throw new Error("Tampered ciphertext was not rejected!");

  // D2. Tampered IV rejection
  let tamperedIvRejected = false;
  try {
    const rawEnv = await encryptTextMessage("Authentic message", chatId, senderId, bobPublicBase64);
    const envObj = unpackE2EEMessage(rawEnv);
    const ivBytes = new Uint8Array(Buffer.from(envObj.iv, "base64"));
    ivBytes[0] ^= 0x01;
    envObj.iv = Buffer.from(ivBytes).toString("base64");
    await decryptTextMessage(packE2EEMessage(envObj), chatId, senderId, alicePublicBase64);
  } catch {
    tamperedIvRejected = true;
  }
  if (!tamperedIvRejected) throw new Error("Tampered IV was not rejected!");

  // D3. Wrong chatId (AAD mismatch) rejection
  let wrongChatIdRejected = false;
  try {
    const rawEnv = await encryptTextMessage("Authentic message", chatId, senderId, bobPublicBase64);
    await decryptTextMessage(rawEnv, "wrong-chat-id", senderId, alicePublicBase64);
  } catch {
    wrongChatIdRejected = true;
  }
  if (!wrongChatIdRejected) throw new Error("Wrong chatId (AAD mismatch) was not rejected!");

  // D4. Wrong senderId (AAD mismatch) rejection
  let wrongSenderIdRejected = false;
  try {
    const rawEnv = await encryptTextMessage("Authentic message", chatId, senderId, bobPublicBase64);
    await decryptTextMessage(rawEnv, chatId, "eve-sender-id", alicePublicBase64);
  } catch {
    wrongSenderIdRejected = true;
  }
  if (!wrongSenderIdRejected) throw new Error("Wrong senderId (AAD mismatch) was not rejected!");

  // D5. Wrong peer public key rejection
  const charliePair = await generateECDHKeyPair(true);
  const charliePublicBase64 = await exportPublicKey(charliePair.publicKey);
  let wrongPeerKeyRejected = false;
  try {
    const rawEnv = await encryptTextMessage("Authentic message", chatId, senderId, bobPublicBase64);
    await decryptTextMessage(rawEnv, chatId, senderId, charliePublicBase64);
  } catch {
    wrongPeerKeyRejected = true;
  }
  if (!wrongPeerKeyRejected) throw new Error("Wrong peer public key was not rejected!");

  console.log("      ✓ Ciphertext tampering, IV tampering, AAD mismatch, and peer mismatch all rejected.");

  console.log("\nAll Phase 3 Step 1 cryptographic tests passed successfully!");
}

runAllTests().catch((err) => {
  console.error("\nTest failure:", err);
  process.exit(1);
});

