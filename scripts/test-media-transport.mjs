import {
  generateECDHKeyPair,
  exportPublicKey,
  isE2EEMediaEnvelope,
  encryptMediaBlob,
  decryptMediaEnvelope,
  clearConversationKeyCache,
} from "../lib/crypto.ts";

console.log("Starting Phase 4.2 E2EE Media Transport Integration Test Suite...\n");

async function runMediaTransportTests() {
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

  const chatId = "test-chat-transport-1";
  const aliceId = "alice-user-1";
  const bobId = "bob-user-2";

  console.log("--- TEST 1: Blob -> encryptMediaBlob() -> Socket payload (Image) ---");
  const rawImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const imageBlob = new Blob([rawImageBytes], { type: "image/jpeg" });

  setActiveIdentity(alicePair);
  const imageEnvelope = await encryptMediaBlob(
    imageBlob,
    chatId,
    aliceId,
    bobPubBase64,
    "image",
  );

  // Construct Socket.IO payload exactly as sent in page.tsx
  const socketPayload = {
    envelope: imageEnvelope,
    clientId: "client-trans-img-1",
    replyToId: null,
  };

  assert(isE2EEMediaEnvelope(socketPayload.envelope), "Socket payload envelope is a valid E2EEMediaEnvelope");
  assert(socketPayload.envelope.type === "image", "Envelope type is 'image'");
  assert(socketPayload.envelope.mime === "image/jpeg", "Envelope mime is 'image/jpeg'");
  assert(typeof socketPayload.envelope.iv === "string" && socketPayload.envelope.iv.length > 0, "IV is present and non-empty");
  assert(typeof socketPayload.envelope.ct === "string" && socketPayload.envelope.ct.length > 0, "Ciphertext is present and non-empty");

  // CRITICAL SECURITY ASSERTION: Original plaintext bytes are NOT present in the emitted socket payload
  const serializedPayload = JSON.stringify(socketPayload);
  const rawPlaintextLatin1 = String.fromCharCode(...rawImageBytes);
  assert(!serializedPayload.includes(rawPlaintextLatin1), "Original plaintext image bytes are NOT present in emitted payload");
  assert(!serializedPayload.includes("JFIF"), "Plaintext JFIF header is NOT present in emitted payload");
  assert(!("text" in socketPayload), "Plaintext text field is NOT present in socket payload");
  assert(!("blob" in socketPayload), "Blob object is NOT present in socket payload");

  console.log("\n--- TEST 2: Received envelope -> decryptMediaEnvelope() -> Original Image Bytes ---");
  setActiveIdentity(bobPair);
  const decryptedImageBlob = await decryptMediaEnvelope(
    socketPayload.envelope,
    chatId,
    aliceId, // sender was alice
    alicePubBase64,
  );

  assert(decryptedImageBlob instanceof Blob, "Decrypted result is a Blob");
  assert(decryptedImageBlob.type === "image/jpeg", "Decrypted Blob preserves mime type");
  const decryptedImageBytes = new Uint8Array(await decryptedImageBlob.arrayBuffer());
  assert(
    decryptedImageBytes.length === rawImageBytes.length &&
      decryptedImageBytes.every((b, i) => b === rawImageBytes[i]),
    "Decrypted image bytes match original plaintext bytes exactly",
  );

  console.log("\n--- TEST 3: Blob -> encryptMediaBlob() -> Socket payload (Audio) ---");
  const rawAudioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]);
  const audioBlob = new Blob([rawAudioBytes], { type: "audio/webm" });

  setActiveIdentity(bobPair);
  const audioEnvelope = await encryptMediaBlob(
    audioBlob,
    chatId,
    bobId,
    alicePubBase64,
    "audio",
  );

  const audioSocketPayload = {
    roomId: "room-friend-audio-1",
    senderId: bobId,
    envelope: audioEnvelope,
    replyToId: null,
  };

  assert(isE2EEMediaEnvelope(audioSocketPayload.envelope), "Audio payload envelope is valid E2EEMediaEnvelope");
  assert(audioSocketPayload.envelope.type === "audio", "Envelope type is 'audio'");
  assert(audioSocketPayload.envelope.mime === "audio/webm", "Envelope mime is 'audio/webm'");

  const serializedAudioPayload = JSON.stringify(audioSocketPayload);
  const rawAudioLatin1 = String.fromCharCode(...rawAudioBytes);
  assert(!serializedAudioPayload.includes(rawAudioLatin1), "Original audio plaintext bytes are NOT present in emitted payload");

  console.log("\n--- TEST 4: Received envelope -> decryptMediaEnvelope() -> Original Audio Bytes ---");
  setActiveIdentity(alicePair);
  const decryptedAudioBlob = await decryptMediaEnvelope(
    audioSocketPayload.envelope,
    chatId,
    bobId,
    bobPubBase64,
  );

  assert(decryptedAudioBlob instanceof Blob, "Decrypted audio result is a Blob");
  assert(decryptedAudioBlob.type === "audio/webm", "Decrypted audio preserves audio/webm mime");
  const decryptedAudioBytes = new Uint8Array(await decryptedAudioBlob.arrayBuffer());
  assert(
    decryptedAudioBytes.length === rawAudioBytes.length &&
      decryptedAudioBytes.every((b, i) => b === rawAudioBytes[i]),
    "Decrypted audio bytes match original plaintext bytes exactly",
  );

  console.log("\n--- TEST 5: Tampered payload verification ---");
  let tamperedCaught = false;
  try {
    const tamperedPayload = JSON.parse(JSON.stringify(audioSocketPayload));
    // Tamper with one base64 character in ciphertext
    const ct = tamperedPayload.envelope.ct;
    tamperedPayload.envelope.ct = ct.substring(0, ct.length - 2) + "==";
    await decryptMediaEnvelope(
      tamperedPayload.envelope,
      chatId,
      bobId,
      bobPubBase64,
    );
  } catch (err) {
    tamperedCaught = true;
  }
  assert(tamperedCaught, "Tampered ciphertext payload is rejected during client decryption");

  console.log(`\n========================================`);
  console.log(`Phase 4.2 Transport Tests Finished: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runMediaTransportTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
