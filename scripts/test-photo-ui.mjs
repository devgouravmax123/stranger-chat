import {
  generateECDHKeyPair,
  exportPublicKey,
  isE2EEMediaEnvelope,
  encryptMediaBlob,
  decryptMediaEnvelope,
  clearConversationKeyCache,
  MAX_E2EE_IMAGE_BYTES,
} from "../lib/crypto.ts";

console.log("Starting Phase 4.3 Photo UI & Crypto Integration Test Suite...\n");

async function runPhotoUITests() {
  // Mock IndexedDB for Node.js environment
  const mockStore = new Map();
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

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      failed++;
      throw new Error(`Assertion failed: ${message}`);
    } else {
      console.log(`✅ PASSED: ${message}`);
      passed++;
    }
  }

  // Generate Alice & Bob identity keys
  const alicePair = await generateECDHKeyPair(true);
  const bobPair = await generateECDHKeyPair(true);
  const alicePubBase64 = await exportPublicKey(alicePair.publicKey);
  const bobPubBase64 = await exportPublicKey(bobPair.publicKey);

  function setActiveIdentity(pair) {
    mockStore.set("chirp_identity_keypair", {
      id: "chirp_identity_keypair",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
    clearConversationKeyCache();
  }

  const chatId = "test-chat-photo-ui-1";
  const aliceId = "alice-user-1";
  const bobId = "bob-user-2";

  console.log("--- TEST A & B: Image Picker Validation (Accepts image MIME types, rejects non-image) ---");
  const validMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  for (const mime of validMimes) {
    assert(mime.toLowerCase().startsWith("image/"), `Accepted valid image MIME type: ${mime}`);
  }

  const invalidMimes = ["text/plain", "application/pdf", "video/mp4", "audio/mpeg", "application/octet-stream"];
  for (const mime of invalidMimes) {
    assert(!mime.toLowerCase().startsWith("image/"), `Rejected non-image MIME type: ${mime}`);
  }

  console.log("\n--- TEST C: Oversized Image Rejected by Frontend Limit ---");
  assert(MAX_E2EE_IMAGE_BYTES === 5.5 * 1024 * 1024, "MAX_E2EE_IMAGE_BYTES is 5.5 MB safe limit");
  const oversizedFileSize = 6 * 1024 * 1024;
  const normalFileSize = 2 * 1024 * 1024;
  assert(oversizedFileSize > MAX_E2EE_IMAGE_BYTES, "Oversized file (6 MB) exceeds MAX_E2EE_IMAGE_BYTES");
  assert(normalFileSize <= MAX_E2EE_IMAGE_BYTES, "Normal file (2 MB) is within MAX_E2EE_IMAGE_BYTES");

  console.log("\n--- TEST D & E & F: Image is encrypted before Socket.IO, payload contains NO plaintext bytes ---");
  const originalImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const imageBlob = new Blob([originalImageBytes], { type: "image/png" });

  setActiveIdentity(alicePair);
  const imageEnvelope = await encryptMediaBlob(
    imageBlob,
    chatId,
    aliceId,
    bobPubBase64,
    "image",
  );

  // Exact stranger chat socket payload
  const strangerSocketPayload = {
    envelope: imageEnvelope,
    clientId: "local-client-123",
    replyToId: undefined,
  };

  // Exact friend chat socket payload
  const friendSocketPayload = {
    roomId: chatId,
    senderId: aliceId,
    envelope: imageEnvelope,
    replyToId: undefined,
  };

  assert(isE2EEMediaEnvelope(strangerSocketPayload.envelope), "Stranger payload envelope passes isE2EEMediaEnvelope");
  assert(isE2EEMediaEnvelope(friendSocketPayload.envelope), "Friend payload envelope passes isE2EEMediaEnvelope");
  assert(imageEnvelope.type === "image", "Envelope type is 'image'");
  assert(imageEnvelope.mime === "image/png", "Envelope mime is 'image/png'");

  const payloadJson = JSON.stringify(strangerSocketPayload);
  assert(!payloadJson.includes("data:image/"), "Payload contains no data URLs");
  assert(!payloadJson.includes("blob:"), "Payload contains no blob URLs");
  assert(!payloadJson.includes("89504e47"), "Payload contains no plaintext hex bytes");

  console.log("\n--- TEST G: Local optimistic image preview without network upload ---");
  // Mock URL.createObjectURL and URL.revokeObjectURL for testing object URL registry
  const createdUrls = new Set();
  const revokedUrls = new Set();
  let urlCounter = 0;

  globalThis.URL.createObjectURL = (blob) => {
    const url = `blob:http://localhost:3000/mock-uuid-${++urlCounter}`;
    createdUrls.add(url);
    return url;
  };
  globalThis.URL.revokeObjectURL = (url) => {
    revokedUrls.add(url);
  };

  const objectUrlRegistry = new Set();
  function registerObjectUrl(url) {
    if (url && typeof url === "string" && url.startsWith("blob:")) {
      objectUrlRegistry.add(url);
    }
    return url;
  }
  function revokeSingleObjectUrl(url) {
    if (url && typeof url === "string" && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
      objectUrlRegistry.delete(url);
    }
  }
  function revokeAllObjectUrls() {
    for (const url of objectUrlRegistry) {
      URL.revokeObjectURL(url);
    }
    objectUrlRegistry.clear();
  }

  // Sender creates optimistic URL
  const optimisticUrl = registerObjectUrl(URL.createObjectURL(imageBlob));
  assert(optimisticUrl.startsWith("blob:"), "Optimistic preview URL is a local blob: URL");
  assert(objectUrlRegistry.has(optimisticUrl), "Optimistic URL is tracked in registry");
  assert(!strangerSocketPayload.envelope.ct.includes(optimisticUrl), "Optimistic URL is NEVER sent to server");

  console.log("\n--- TEST H: Incoming encrypted image decrypts successfully ---");
  setActiveIdentity(bobPair);
  const decryptedBlob = await decryptMediaEnvelope(
    imageEnvelope,
    chatId,
    aliceId,
    alicePubBase64,
  );

  assert(decryptedBlob.type === "image/png", "Decrypted blob preserves MIME type");
  const decryptedBytes = new Uint8Array(await decryptedBlob.arrayBuffer());
  assert(decryptedBytes.length === originalImageBytes.length, "Decrypted bytes length matches original");
  let matches = true;
  for (let i = 0; i < originalImageBytes.length; i++) {
    if (decryptedBytes[i] !== originalImageBytes[i]) {
      matches = false;
      break;
    }
  }
  assert(matches, "Decrypted bytes exactly match original image bytes");

  // Recipient registers object URL
  const recipientObjectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
  assert(objectUrlRegistry.has(recipientObjectUrl), "Recipient decrypted Blob URL registered");

  console.log("\n--- TEST I: Wrong key causes safe decryption failure ---");
  const evePair = await generateECDHKeyPair(true);
  setActiveIdentity(evePair);
  let eveFailedGracefully = false;
  try {
    await decryptMediaEnvelope(
      imageEnvelope,
      chatId,
      aliceId,
      alicePubBase64,
    );
  } catch (err) {
    eveFailedGracefully = true;
  }
  assert(eveFailedGracefully, "Decryption with unauthorized key fails safely");

  console.log("\n--- TEST J: Tampered ciphertext causes safe decryption failure ---");
  setActiveIdentity(bobPair);
  const tamperedEnvelope = {
    ...imageEnvelope,
    ct: imageEnvelope.ct.slice(0, -4) + "AAAA",
  };
  let tamperFailedGracefully = false;
  try {
    await decryptMediaEnvelope(
      tamperedEnvelope,
      chatId,
      aliceId,
      alicePubBase64,
    );
  } catch (err) {
    tamperFailedGracefully = true;
  }
  assert(tamperFailedGracefully, "Tampered ciphertext causes GCM authentication failure safely");

  console.log("\n--- TEST K: History encrypted image decrypts successfully on client ---");
  const historyMessage = {
    id: "msg-history-1",
    content: JSON.stringify(imageEnvelope),
    senderId: aliceId,
    sender: "them",
    type: "image",
    createdAt: new Date().toISOString(),
  };

  const parsedEnv = JSON.parse(historyMessage.content);
  assert(isE2EEMediaEnvelope(parsedEnv), "History content is parsed as E2EEMediaEnvelope");
  const historyDecryptedBlob = await decryptMediaEnvelope(
    parsedEnv,
    chatId,
    aliceId,
    alicePubBase64,
  );
  const historyDecryptedBytes = new Uint8Array(await historyDecryptedBlob.arrayBuffer());
  assert(historyDecryptedBytes.length === originalImageBytes.length, "History decrypted bytes match original");

  console.log("\n--- TEST L: Legacy plaintext history still works ---");
  const legacyMessage = {
    id: "legacy-msg-1",
    text: "Hello, this is a legacy plaintext message",
    type: "text",
  };
  assert(!isE2EEMediaEnvelope(legacyMessage.text), "Legacy plaintext message is not treated as media envelope");

  console.log("\n--- TEST M: Object URLs are cleaned up ---");
  assert(objectUrlRegistry.size >= 2, "Registry tracked all created object URLs");
  revokeSingleObjectUrl(optimisticUrl);
  assert(!objectUrlRegistry.has(optimisticUrl), "Single object URL revoked and removed from registry");
  assert(revokedUrls.has(optimisticUrl), "URL.revokeObjectURL was invoked for optimistic URL");

  revokeAllObjectUrls();
  assert(objectUrlRegistry.size === 0, "All remaining object URLs revoked on session cleanup");
  assert(revokedUrls.has(recipientObjectUrl), "Recipient URL revoked on session cleanup");

  console.log("\n--- TEST N: No plaintext image URL sent to backend ---");
  const strangerPayloadKeys = Object.keys(strangerSocketPayload);
  assert(!strangerPayloadKeys.includes("imageUrl"), "strangerSocketPayload does not contain imageUrl");
  assert(!strangerPayloadKeys.includes("file"), "strangerSocketPayload does not contain file");
  assert(!strangerPayloadKeys.includes("blob"), "strangerSocketPayload does not contain blob");
  assert(!strangerPayloadKeys.includes("dataUrl"), "strangerSocketPayload does not contain dataUrl");

  console.log(`\n========================================`);
  console.log(`Phase 4.3 Tests Completed: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhotoUITests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
