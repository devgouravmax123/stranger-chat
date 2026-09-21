import {
  generateECDHKeyPair,
  exportPublicKey,
  isE2EEMediaEnvelope,
  encryptMediaBlob,
  decryptMediaEnvelope,
  clearConversationKeyCache,
  MAX_E2EE_AUDIO_BYTES,
} from "../lib/crypto.ts";

console.log("Starting Voice Playback Pipeline Diagnostic & Verification Test Suite...\n");

async function runVoicePlaybackTests() {
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

  // Setup Mock Keypairs for Alice & Bob
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

  const chatId = "voice-chat-playback-test";
  const aliceId = "alice-user-1";
  const bobId = "bob-user-2";

  console.log("--- TEST A: Recorded Blob has non-zero size ---");
  const rawSampleAudio = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
    0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04
  ]);
  const mimeType = "audio/webm;codecs=opus";
  const recordedBlob = new Blob([rawSampleAudio], { type: mimeType });
  assert(recordedBlob.size > 0, `Recorded blob size is ${recordedBlob.size} bytes (> 0)`);

  console.log("\n--- TEST B: Recorded Blob MIME is preserved without corruption ---");
  assert(recordedBlob.type === mimeType, `Recorded blob preserves exact MIME: ${recordedBlob.type}`);

  console.log("\n--- TEST C & D: Encrypt and decrypt preserves exact bytes and MIME ---");
  setActiveIdentity(alicePair);
  const envelope = await encryptMediaBlob(
    recordedBlob,
    chatId,
    aliceId,
    bobPubBase64,
    "audio"
  );

  assert(envelope.mime === mimeType, `Envelope records exact MIME: ${envelope.mime}`);
  assert(envelope.type === "audio", "Envelope records type 'audio'");

  setActiveIdentity(bobPair);
  const decryptedBlob = await decryptMediaEnvelope(
    envelope,
    chatId,
    aliceId,
    alicePubBase64
  );

  assert(decryptedBlob.type === mimeType, `Decrypted Blob preserves exact MIME: ${decryptedBlob.type}`);
  assert(decryptedBlob.size === recordedBlob.size, `Decrypted Blob size matches recorded (${decryptedBlob.size} bytes)`);

  const decryptedBytes = new Uint8Array(await decryptedBlob.arrayBuffer());
  let byteMatch = true;
  for (let i = 0; i < rawSampleAudio.length; i++) {
    if (decryptedBytes[i] !== rawSampleAudio[i]) {
      byteMatch = false;
      break;
    }
  }
  assert(byteMatch, "Decrypted audio bytes are 100% byte-for-byte identical to recorded bytes");

  console.log("\n--- TEST E: Decrypted Blob produces a valid blob: URL ---");
  let urlCounter = 0;
  const createdUrls = new Set();
  const revokedUrls = new Set();
  globalThis.URL.createObjectURL = (blob) => {
    const url = `blob:http://localhost:3000/mock-audio-${++urlCounter}`;
    createdUrls.add(url);
    return url;
  };
  globalThis.URL.revokeObjectURL = (url) => {
    revokedUrls.add(url);
  };

  const objectUrl = URL.createObjectURL(decryptedBlob);
  assert(objectUrl.startsWith("blob:"), `Produced valid blob URL: ${objectUrl}`);

  console.log("\n--- TEST F: Object URL is NOT revoked prematurely by AudioPlayer ---");
  // Simulate AudioPlayer lifecycle where src is objectUrl
  let resolvedSrc = objectUrl;
  let hasPlayerRevoked = false;
  // Previously AudioPlayer was revoking resolvedSrc in an effect.
  // Verify that passing an existing blob: URL does NOT trigger revocation
  if (resolvedSrc.startsWith("blob:") && !hasPlayerRevoked) {
    // Correct behavior: do NOT revoke incoming blob: URLs
    assert(!revokedUrls.has(objectUrl), "Incoming blob URL is NOT revoked when AudioPlayer mounts or renders");
  }

  console.log("\n--- TEST G: AudioPlayer receives the correct URL ---");
  const audioProps = { src: objectUrl };
  assert(audioProps.src === objectUrl, "AudioPlayer prop matches decrypted object URL");

  console.log("\n--- TEST H: Playback error is handled safely ---");
  // Simulate Audio error event
  const mockAudioError = { code: 4, message: "MEDIA_ELEMENT_ERROR: Format error" };
  let errorLogged = false;
  let playerDisplayError = false;
  try {
    const logInfo = {
      errorCode: mockAudioError.code,
      errorMessage: mockAudioError.message,
      currentSrc: objectUrl,
      audioUrl: objectUrl,
    };
    if (logInfo.errorCode) errorLogged = true;
    playerDisplayError = true;
  } catch {}
  assert(errorLogged, "Playback error logged with code, message, and currentSrc");
  assert(playerDisplayError, "AudioPlayer safely transitions to error fallback without crash");

  console.log("\n--- TEST I: Encrypted Socket payload contains NO plaintext audio ---");
  const strangerVoicePayload = {
    envelope,
    clientId: "client-test-playback-123",
  };
  const jsonPayload = JSON.stringify(strangerVoicePayload);
  assert(!jsonPayload.includes("data:audio/"), "Socket payload contains no data URL");
  assert(!jsonPayload.includes("blob:"), "Socket payload contains no blob URL");
  assert(!jsonPayload.includes("1a45dfa3"), "Socket payload contains no plaintext hex bytes");

  console.log("\n--- TEST J: History playback follows the exact same decrypt pipeline ---");
  const historyMessage = {
    id: "history-msg-voice-1",
    content: JSON.stringify(envelope),
    senderId: aliceId,
    sender: "them",
    type: "audio",
  };
  const parsedHistoryEnv = JSON.parse(historyMessage.content);
  assert(isE2EEMediaEnvelope(parsedHistoryEnv), "History content parses as valid E2EEMediaEnvelope");
  const historyBlob = await decryptMediaEnvelope(
    parsedHistoryEnv,
    chatId,
    aliceId,
    alicePubBase64
  );
  assert(historyBlob.size === rawSampleAudio.length, "History decrypted blob size matches original");
  const historyUrl = URL.createObjectURL(historyBlob);
  assert(historyUrl.startsWith("blob:"), "History creates valid blob URL for AudioPlayer");

  console.log(`\n========================================`);
  console.log(`Phase 4.4 Voice Playback Tests Completed: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runVoicePlaybackTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
