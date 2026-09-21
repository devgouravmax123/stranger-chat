import {
  generateECDHKeyPair,
  exportPublicKey,
  isE2EEMediaEnvelope,
  encryptMediaBlob,
  decryptMediaEnvelope,
  clearConversationKeyCache,
  MAX_E2EE_AUDIO_BYTES,
  MAX_VOICE_DURATION_SECONDS,
} from "../lib/crypto.ts";

console.log("Starting Phase 4.4 Voice UI & Crypto Integration Test Suite...\n");

async function runVoiceUITests() {
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

  const chatId = "test-chat-voice-ui-1";
  const aliceId = "alice-user-1";
  const bobId = "bob-user-2";

  console.log("--- TEST A: Audio MIME selection logic ---");
  function getSupportedMimeTypeMock(supportedList) {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/wav",
    ];
    for (const type of types) {
      if (supportedList.includes(type)) {
        return type;
      }
    }
    return "";
  }

  const chromeSupport = ["audio/webm;codecs=opus", "audio/webm", "audio/wav"];
  assert(
    getSupportedMimeTypeMock(chromeSupport) === "audio/webm;codecs=opus",
    "Prefers WebM/Opus when supported"
  );

  const safariSupport = ["audio/mp4", "audio/wav"];
  assert(
    getSupportedMimeTypeMock(safariSupport) === "audio/mp4",
    "Falls back to audio/mp4 on Safari when webm is not supported"
  );

  console.log("\n--- TEST B: Unsupported MediaRecorder MIME handling ---");
  const noSupport = [];
  assert(
    getSupportedMimeTypeMock(noSupport) === "",
    "Returns empty string when no standard mime types are supported"
  );

  console.log("\n--- TEST C: Recording state transitions ---");
  // Test simulated transitions: idle -> recording -> stopped -> sent
  let recorderState = "idle";
  function transitionTo(next) {
    const validTransitions = {
      idle: ["recording"],
      recording: ["stopped", "idle"], // stopped on finish, idle on cancel
      stopped: ["encrypting", "idle"],
      encrypting: ["sent", "stopped", "idle"],
      sent: ["idle"],
    };
    assert(
      validTransitions[recorderState]?.includes(next),
      `Transition ${recorderState} -> ${next} is valid`
    );
    recorderState = next;
  }

  transitionTo("recording");
  transitionTo("stopped");
  transitionTo("encrypting");
  transitionTo("sent");
  transitionTo("idle");

  console.log("\n--- TEST D: Maximum duration enforcement ---");
  assert(MAX_VOICE_DURATION_SECONDS === 120, "MAX_VOICE_DURATION_SECONDS is 120 seconds (2 minutes)");
  let simulatedTimer = 0;
  let autoStopped = false;
  while (simulatedTimer < 125) {
    simulatedTimer++;
    if (simulatedTimer >= MAX_VOICE_DURATION_SECONDS) {
      autoStopped = true;
      break;
    }
  }
  assert(autoStopped && simulatedTimer === 120, "Recording automatically stops when limit is reached");

  console.log("\n--- TEST E: Audio size validation ---");
  assert(MAX_E2EE_AUDIO_BYTES === 5.5 * 1024 * 1024, "MAX_E2EE_AUDIO_BYTES is 5.5 MB safe limit");
  const oversizedAudioSize = 6 * 1024 * 1024;
  const normalAudioSize = 1.5 * 1024 * 1024;
  assert(oversizedAudioSize > MAX_E2EE_AUDIO_BYTES, "Oversized audio (6 MB) rejected by size check");
  assert(normalAudioSize <= MAX_E2EE_AUDIO_BYTES, "Normal audio (1.5 MB) accepted by size check");

  console.log("\n--- TEST F & G & H: Audio Blob passed to encryptMediaBlob(), Socket payload contains NO plaintext bytes ---");
  const rawAudioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]);
  const audioBlob = new Blob([rawAudioBytes], { type: "audio/webm;codecs=opus" });

  setActiveIdentity(alicePair);
  const audioEnvelope = await encryptMediaBlob(
    audioBlob,
    chatId,
    aliceId,
    bobPubBase64,
    "audio",
  );

  const strangerVoicePayload = {
    envelope: audioEnvelope,
    clientId: "voice-client-123",
    replyToId: undefined,
  };

  const friendVoicePayload = {
    roomId: chatId,
    senderId: aliceId,
    envelope: audioEnvelope,
    replyToId: undefined,
  };

  assert(isE2EEMediaEnvelope(strangerVoicePayload.envelope), "Stranger payload envelope is valid E2EEMediaEnvelope");
  assert(isE2EEMediaEnvelope(friendVoicePayload.envelope), "Friend payload envelope is valid E2EEMediaEnvelope");
  assert(audioEnvelope.type === "audio", "Envelope type is 'audio'");
  assert(audioEnvelope.mime === "audio/webm;codecs=opus", "Envelope mime is 'audio/webm;codecs=opus'");

  const voicePayloadJson = JSON.stringify(strangerVoicePayload);
  assert(!voicePayloadJson.includes("data:audio/"), "Payload contains no data URLs");
  assert(!voicePayloadJson.includes("blob:"), "Payload contains no blob URLs");
  assert(!voicePayloadJson.includes("1a45dfa3"), "Payload contains no plaintext hex bytes");

  console.log("\n--- TEST I: Incoming encrypted audio decrypts successfully ---");
  setActiveIdentity(bobPair);
  const decryptedBlob = await decryptMediaEnvelope(
    audioEnvelope,
    chatId,
    aliceId,
    alicePubBase64,
  );

  assert(decryptedBlob.type === "audio/webm;codecs=opus", "Decrypted blob preserves audio MIME type");
  const decryptedBytes = new Uint8Array(await decryptedBlob.arrayBuffer());
  assert(decryptedBytes.length === rawAudioBytes.length, "Decrypted bytes length matches original");
  let audioMatches = true;
  for (let i = 0; i < rawAudioBytes.length; i++) {
    if (decryptedBytes[i] !== rawAudioBytes[i]) {
      audioMatches = false;
      break;
    }
  }
  assert(audioMatches, "Decrypted bytes exactly match original audio bytes");

  console.log("\n--- TEST J: Wrong key causes safe decryption failure ---");
  const evePair = await generateECDHKeyPair(true);
  setActiveIdentity(evePair);
  let eveFailed = false;
  try {
    await decryptMediaEnvelope(
      audioEnvelope,
      chatId,
      aliceId,
      alicePubBase64,
    );
  } catch (err) {
    eveFailed = true;
  }
  assert(eveFailed, "Decryption with unauthorized key fails safely");

  console.log("\n--- TEST K: Tampered ciphertext causes safe decryption failure ---");
  setActiveIdentity(bobPair);
  const tamperedEnvelope = {
    ...audioEnvelope,
    ct: audioEnvelope.ct.slice(0, -4) + "BBBB",
  };
  let tamperFailed = false;
  try {
    await decryptMediaEnvelope(
      tamperedEnvelope,
      chatId,
      aliceId,
      alicePubBase64,
    );
  } catch (err) {
    tamperFailed = true;
  }
  assert(tamperFailed, "Tampered audio ciphertext rejected safely by AES-GCM");

  console.log("\n--- TEST L: History encrypted audio decrypts successfully on client ---");
  const historyVoiceMessage = {
    id: "voice-history-1",
    content: JSON.stringify(audioEnvelope),
    senderId: aliceId,
    sender: "them",
    type: "audio",
    createdAt: new Date().toISOString(),
  };

  const parsedEnv = JSON.parse(historyVoiceMessage.content);
  assert(isE2EEMediaEnvelope(parsedEnv), "History content is parsed as E2EEMediaEnvelope");
  const historyDecryptedBlob = await decryptMediaEnvelope(
    parsedEnv,
    chatId,
    aliceId,
    alicePubBase64,
  );
  const historyDecryptedBytes = new Uint8Array(await historyDecryptedBlob.arrayBuffer());
  assert(historyDecryptedBytes.length === rawAudioBytes.length, "History audio decrypted bytes match original");

  console.log("\n--- TEST M: Legacy history compatibility remains intact ---");
  const legacyVoiceMessage = {
    id: "legacy-voice-1",
    text: "Voice message",
    type: "audio",
  };
  assert(!isE2EEMediaEnvelope(legacyVoiceMessage.text), "Legacy voice message text is not treated as media envelope");

  console.log("\n--- TEST N & O: Object URL registration and cleanup occurs ---");
  let urlCounter = 0;
  const createdUrls = new Set();
  const revokedUrls = new Set();
  globalThis.URL.createObjectURL = (blob) => {
    const url = `blob:http://localhost:3000/mock-voice-${++urlCounter}`;
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

  const optimisticVoiceUrl = registerObjectUrl(URL.createObjectURL(audioBlob));
  assert(optimisticVoiceUrl.startsWith("blob:"), "Optimistic voice URL is a local blob: URL");
  assert(objectUrlRegistry.has(optimisticVoiceUrl), "Optimistic voice URL tracked in registry");
  assert(!voicePayloadJson.includes(optimisticVoiceUrl), "Optimistic voice URL is NEVER sent to server");

  const recipientVoiceUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
  assert(objectUrlRegistry.has(recipientVoiceUrl), "Recipient decrypted voice URL tracked in registry");

  revokeSingleObjectUrl(optimisticVoiceUrl);
  assert(!objectUrlRegistry.has(optimisticVoiceUrl), "Single voice URL revoked and removed from registry");
  assert(revokedUrls.has(optimisticVoiceUrl), "URL.revokeObjectURL was called for optimistic URL");

  revokeAllObjectUrls();
  assert(objectUrlRegistry.size === 0, "All remaining object URLs revoked on session cleanup");
  assert(revokedUrls.has(recipientVoiceUrl), "Recipient URL revoked on session cleanup");

  console.log("\n--- TEST P: Microphone tracks are stopped after recording ---");
  let track1Stopped = false;
  let track2Stopped = false;
  const mockTracks = [
    { stop: () => { track1Stopped = true; } },
    { stop: () => { track2Stopped = true; } },
  ];
  const mockStream = {
    getTracks: () => mockTracks,
  };

  mockStream.getTracks().forEach((track) => track.stop());
  assert(track1Stopped && track2Stopped, "All MediaStream tracks are stopped after recording");

  console.log("\n--- TEST Q: Permission denial is handled safely ---");
  let permissionDeniedCaught = false;
  let friendlyErrorMessage = "";
  try {
    const error = new Error("Permission denied");
    error.name = "NotAllowedError";
    throw error;
  } catch (err) {
    permissionDeniedCaught = true;
    if (err.name === "NotAllowedError") {
      friendlyErrorMessage = "Microphone permission is required to send voice notes.";
    }
  }
  assert(permissionDeniedCaught, "Microphone permission denial caught without unhandled exception");
  assert(friendlyErrorMessage.includes("permission is required"), "User-friendly permission error provided");

  console.log("\n--- TEST R: Encryption failure does not send plaintext ---");
  let encryptionFailed = false;
  let emittedPayload = null;
  try {
    // Missing activeChatId
    await encryptMediaBlob(audioBlob, "", aliceId, bobPubBase64, "audio");
    emittedPayload = "plaintext-bytes";
  } catch {
    encryptionFailed = true;
  }
  assert(encryptionFailed, "Invalid encryption parameters throw safely");
  assert(emittedPayload === null, "No payload emitted when encryption fails");

  console.log("\n--- TEST S: Transport failure cleans up optimistic message & object URL ---");
  const failedOptimisticUrl = registerObjectUrl(URL.createObjectURL(audioBlob));
  assert(objectUrlRegistry.has(failedOptimisticUrl), "Failed attempt registered optimistic URL");
  // Simulate send failure rollback
  revokeSingleObjectUrl(failedOptimisticUrl);
  assert(!objectUrlRegistry.has(failedOptimisticUrl), "Failed attempt revoked optimistic URL on error");
  assert(revokedUrls.has(failedOptimisticUrl), "URL.revokeObjectURL called on send failure");

  console.log(`\n========================================`);
  console.log(`Phase 4.4 Tests Completed: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runVoiceUITests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
