/**
 * Comprehensive Phase 2B Integration Test Suite
 * Tests encrypted voice note upload, B2 presigned upload/download, v1/v2 coexistence,
 * upload ordering (PUT before Socket.IO), failure handling, and playback.
 */

import {
  generateECDHKeyPair,
  exportPublicKey,
  encryptMediaBlobToBinary,
  decryptMediaRawBytes,
  encryptMediaBlob,
  decryptMediaEnvelope,
  isE2EEMediaEnvelope,
  isE2EEMediaV2Envelope,
  isE2EEAnyMediaEnvelope,
  unpackE2EEAnyMedia,
  MAX_E2EE_AUDIO_BYTES,
  MAX_VOICE_DURATION_SECONDS,
} from "../lib/crypto.ts";

const BACKEND_URL = "http://localhost:3001";

async function uploadEncryptedMediaToB2(
  blob,
  chatId,
  senderId,
  peerPublicKey,
  type,
  authToken
) {
  if (!authToken) {
    throw new Error("[MediaUploader] Missing authentication session token.");
  }

  const encrypted = await encryptMediaBlobToBinary(
    blob,
    chatId,
    senderId,
    peerPublicKey,
    type
  );

  const presignRes = await fetch(`${BACKEND_URL}/media/presigned-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      chatId,
      mediaType: type,
      mimeType: encrypted.mime,
      fileSize: encrypted.fileSize,
      iv: encrypted.iv,
    }),
  });

  if (!presignRes.ok) {
    const errorBody = await presignRes.text().catch(() => "");
    throw new Error(
      `[MediaUploader] Presigned upload request failed (${presignRes.status}): ${errorBody}`
    );
  }

  const presignData = await presignRes.json();
  if (!presignData?.uploadUrl || !presignData?.mediaId || !presignData?.storageKey) {
    throw new Error("[MediaUploader] Invalid presigned upload response from server.");
  }

  const putRes = await fetch(presignData.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": encrypted.mime,
    },
    body: encrypted.rawEncryptedBytes,
  });

  if (!putRes.ok) {
    throw new Error(
      `[MediaUploader] Direct B2 upload failed with HTTP status ${putRes.status}.`
    );
  }

  const envelope = {
    e2ee: true,
    v: 2,
    type,
    mediaId: presignData.mediaId,
    storageKey: presignData.storageKey,
    mime: encrypted.mime,
    iv: encrypted.iv,
    fileSize: encrypted.fileSize,
  };

  return { envelope };
}

async function downloadAndDecryptMediaFromB2(
  envelope,
  chatId,
  senderId,
  peerPublicKey,
  authToken
) {
  if (!authToken) {
    throw new Error("[MediaUploader] Missing authentication session token.");
  }

  const presignRes = await fetch(
    `${BACKEND_URL}/media/presigned-download/${encodeURIComponent(envelope.mediaId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  if (!presignRes.ok) {
    const errorBody = await presignRes.text().catch(() => "");
    throw new Error(
      `[MediaUploader] Presigned download request failed (${presignRes.status}): ${errorBody}`
    );
  }

  const presignData = await presignRes.json();
  if (!presignData?.downloadUrl) {
    throw new Error("[MediaUploader] Invalid presigned download response from server.");
  }

  const getRes = await fetch(presignData.downloadUrl);
  if (!getRes.ok) {
    throw new Error(
      `[MediaUploader] Direct B2 download failed with HTTP status ${getRes.status}.`
    );
  }

  const rawEncryptedBytes = await getRes.arrayBuffer();

  const decryptedBlob = await decryptMediaRawBytes(
    rawEncryptedBytes,
    envelope.iv,
    envelope.mime,
    envelope.type,
    chatId,
    senderId,
    peerPublicKey
  );

  return decryptedBlob;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed++;
  }
}

async function runPhase2BTests() {
  console.log("Starting Phase 2B Backblaze B2 Voice Note Integration Test Suite...\n");

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

  // Setup keys and test identities
  const aliceKeyPair = await generateECDHKeyPair(true);
  const alicePubBase64 = await exportPublicKey(aliceKeyPair.publicKey);
  const bobKeyPair = await generateECDHKeyPair(true);
  const bobPubBase64 = await exportPublicKey(bobKeyPair.publicKey);

  function setActiveIdentity(pair) {
    mockStore.set("chirp_identity_keypair", {
      id: "chirp_identity_keypair",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
  }

  setActiveIdentity(aliceKeyPair);

  const chatId = "test-friend-chat-voice-1234";
  const strangerChatId = "test-stranger-chat-voice-5678";
  const aliceId = "alice-voice-sender-001";
  const bobId = "bob-voice-receiver-002";
  const validToken = "valid.mock.session.token";

  // Simulate Opus WebM audio bytes
  const rawAudioBytes = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01,
    0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08,
    0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x02, 0x42, 0x85, 0x81, 0x02
  ]);
  const audioBlob = new Blob([rawAudioBytes], { type: "audio/webm;codecs=opus" });

  // 1. Audio encryption before upload
  console.log("--- TEST 1: Voice Note Audio Encryption before upload ---");
  const binaryEncryptResult = await encryptMediaBlobToBinary(
    audioBlob,
    chatId,
    aliceId,
    bobPubBase64,
    "audio"
  );
  assert(binaryEncryptResult.rawEncryptedBytes instanceof ArrayBuffer, "encryptMediaBlobToBinary returns ArrayBuffer for audio");
  assert(binaryEncryptResult.rawEncryptedBytes.byteLength > 0, "Audio ciphertext binary is non-empty");
  assert(typeof binaryEncryptResult.iv === "string", "Audio IV is Base64 string");
  assert(binaryEncryptResult.mime.startsWith("audio/"), "MIME type starts with audio/");
  assert(binaryEncryptResult.fileSize === audioBlob.size, "Audio file size matches original blob");

  // 2. Mock B2 storage & Backend Presigned Endpoints
  const b2BucketMock = new Map();
  const networkEvents = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);

    // Backend presigned-upload endpoint
    if (urlStr.includes("/media/presigned-upload")) {
      networkEvents.push({ event: "presigned-upload-requested" });
      const authHeader = options.headers?.Authorization || "";
      if (!authHeader.includes("Bearer valid.mock.session.token")) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }

      const body = JSON.parse(options.body);
      if (body.chatId === "unauthorized-chat") {
        return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });
      }

      const mediaId = "voice-media-" + Math.random().toString(36).substr(2, 9);
      const storageKey = `media/${body.chatId}/${mediaId}.bin`;
      const uploadUrl = `https://mock-b2.backblazeb2.com/upload/${mediaId}`;

      return new Response(
        JSON.stringify({
          mediaId,
          storageKey,
          uploadUrl,
          expiresIn: 300,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }

    // Backend presigned-download endpoint
    if (urlStr.includes("/media/presigned-download/")) {
      networkEvents.push({ event: "presigned-download-requested" });
      const authHeader = options.headers?.Authorization || "";
      if (!authHeader.includes("Bearer valid.mock.session.token")) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }

      const mediaId = urlStr.split("/media/presigned-download/")[1];
      if (mediaId === "unauthorized-media") {
        return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });
      }

      const downloadUrl = `https://mock-b2.backblazeb2.com/download/${mediaId}`;
      return new Response(
        JSON.stringify({
          downloadUrl,
          expiresIn: 300,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // B2 Direct Upload (PUT)
    if (urlStr.startsWith("https://mock-b2.backblazeb2.com/upload/")) {
      networkEvents.push({ event: "b2-direct-put-uploaded" });
      const mediaId = urlStr.replace("https://mock-b2.backblazeb2.com/upload/", "");
      if (mediaId.includes("fail-put")) {
        return new Response("Storage error", { status: 500 });
      }
      b2BucketMock.set(mediaId, options.body);
      return new Response("", { status: 200 });
    }

    // B2 Direct Download (GET)
    if (urlStr.startsWith("https://mock-b2.backblazeb2.com/download/")) {
      networkEvents.push({ event: "b2-direct-get-downloaded" });
      const mediaId = urlStr.replace("https://mock-b2.backblazeb2.com/download/", "");
      const data = b2BucketMock.get(mediaId);
      if (!data) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(data, { status: 200 });
    }

    return originalFetch(url, options);
  };

  try {
    // 3. Stranger Voice Upload Flow
    console.log("\n--- TEST 2: Stranger Voice Note Upload Flow (encrypt -> presign -> B2 PUT -> v2 envelope) ---");
    const strangerUpload = await uploadEncryptedMediaToB2(
      audioBlob,
      strangerChatId,
      aliceId,
      bobPubBase64,
      "audio",
      validToken
    );
    assert(isE2EEMediaV2Envelope(strangerUpload.envelope), "Stranger upload returns valid E2EEMediaV2Envelope");
    assert(strangerUpload.envelope.v === 2, "Envelope version is 2");
    assert(strangerUpload.envelope.type === "audio", "Envelope type is audio");
    assert(b2BucketMock.has(strangerUpload.envelope.mediaId), "Raw encrypted audio bytes successfully stored in B2 mock");

    // 4. Friend Voice Upload Flow
    console.log("\n--- TEST 3: Friend Voice Note Upload Flow ---");
    const friendUpload = await uploadEncryptedMediaToB2(
      audioBlob,
      chatId,
      aliceId,
      bobPubBase64,
      "audio",
      validToken
    );
    assert(isE2EEMediaV2Envelope(friendUpload.envelope), "Friend upload returns valid E2EEMediaV2Envelope");
    assert(friendUpload.envelope.v === 2, "Friend envelope version is 2");
    assert(friendUpload.envelope.type === "audio", "Friend envelope type is audio");

    // 5. Strict Network Sequencing: B2 PUT before Socket.IO emit
    console.log("\n--- TEST 4: Strict Network Sequencing (PUT must complete before Socket.IO emit) ---");
    const callOrder = [];
    networkEvents.length = 0;

    const mockSendStrangerVoice = async (blob) => {
      const { envelope } = await uploadEncryptedMediaToB2(
        blob,
        strangerChatId,
        aliceId,
        bobPubBase64,
        "audio",
        validToken
      );
      callOrder.push("socket-emit-after-put");
      return {
        envelope,
        clientId: "client-voice-123",
      };
    };

    const emittedResult = await mockSendStrangerVoice(audioBlob);
    assert(callOrder[0] === "socket-emit-after-put", "Socket.IO emit occurred after uploadEncryptedMediaToB2 completed");
    assert(networkEvents.map((e) => e.event).join(",") === "presigned-upload-requested,b2-direct-put-uploaded", "Exact network sequence verified (presign -> PUT -> emit)");
    assert(isE2EEMediaV2Envelope(emittedResult.envelope), "Emitted payload contains v2 audio media reference");

    // 6. Upload Failure -> No Socket.IO emit
    console.log("\n--- TEST 5: Upload Failure -> No Socket.IO emit & Cleanup ---");
    let failedSocketEmitted = false;
    let voiceUploadThrew = false;

    const mockFailedVoiceSend = async () => {
      try {
        await uploadEncryptedMediaToB2(
          audioBlob,
          "unauthorized-chat",
          aliceId,
          bobPubBase64,
          "audio",
          validToken
        );
        failedSocketEmitted = true;
      } catch (err) {
        voiceUploadThrew = true;
      }
    };

    await mockFailedVoiceSend();
    assert(voiceUploadThrew === true, "Upload threw error on presign failure");
    assert(failedSocketEmitted === false, "Socket.IO message was NOT emitted on failed voice upload");

    // 7. v2 Voice Download & Decryption (Recipient Playback)
    console.log("\n--- TEST 6: v2 Voice Download & Decryption (Recipient Playback Flow) ---");
    setActiveIdentity(bobKeyPair);
    const downloadedAudioBlob = await downloadAndDecryptMediaFromB2(
      strangerUpload.envelope,
      strangerChatId,
      aliceId,
      alicePubBase64,
      validToken
    );
    assert(downloadedAudioBlob instanceof Blob, "downloadAndDecryptMediaFromB2 returns audio Blob");
    assert(downloadedAudioBlob.type === "audio/webm;codecs=opus", "Decrypted Blob preserves exact audio MIME type");
    const decryptedAudioBytes = new Uint8Array(await downloadedAudioBlob.arrayBuffer());
    assert(decryptedAudioBytes.length === rawAudioBytes.length, "Decrypted audio byte length matches original");
    let audioBytesMatch = true;
    for (let i = 0; i < rawAudioBytes.length; i++) {
      if (decryptedAudioBytes[i] !== rawAudioBytes[i]) audioBytesMatch = false;
    }
    assert(audioBytesMatch, "Decrypted audio bytes match original recording exactly");

    // 8. v1/v2 Audio Coexistence & History
    console.log("\n--- TEST 7: v1 and v2 Voice Note Coexistence & History ---");
    setActiveIdentity(aliceKeyPair);
    const v1AudioEnvelope = await encryptMediaBlob(audioBlob, chatId, aliceId, bobPubBase64, "audio");
    assert(isE2EEMediaEnvelope(v1AudioEnvelope), "v1 audio envelope passes isE2EEMediaEnvelope");
    assert(isE2EEAnyMediaEnvelope(v1AudioEnvelope), "v1 audio envelope passes isE2EEAnyMediaEnvelope");
    assert(isE2EEAnyMediaEnvelope(friendUpload.envelope), "v2 audio envelope passes isE2EEAnyMediaEnvelope");

    const unpackedV1Audio = unpackE2EEAnyMedia(JSON.stringify(v1AudioEnvelope));
    const unpackedV2Audio = unpackE2EEAnyMedia(JSON.stringify(friendUpload.envelope));
    assert(unpackedV1Audio && unpackedV1Audio.v === 1 && unpackedV1Audio.type === "audio", "unpackE2EEAnyMedia unpacks v1 audio history");
    assert(unpackedV2Audio && unpackedV2Audio.v === 2 && unpackedV2Audio.type === "audio", "unpackE2EEAnyMedia unpacks v2 audio history");

    // Decrypt both as Bob
    setActiveIdentity(bobKeyPair);
    const v1DecryptedAudio = await decryptMediaEnvelope(unpackedV1Audio, chatId, aliceId, alicePubBase64);
    assert(v1DecryptedAudio.size === audioBlob.size, "v1 audio history decodes correctly");

    const v2DecryptedAudio = await downloadAndDecryptMediaFromB2(
      unpackedV2Audio,
      chatId,
      aliceId,
      alicePubBase64,
      validToken
    );
    assert(v2DecryptedAudio.size === audioBlob.size, "v2 audio history decodes correctly");

    // 9. Unauthorized Download Protection
    console.log("\n--- TEST 8: Unauthorized Voice Download Protection ---");
    let unauthorizedThrew = false;
    try {
      const unauthorizedEnvelope = { ...strangerUpload.envelope, mediaId: "unauthorized-media" };
      await downloadAndDecryptMediaFromB2(
        unauthorizedEnvelope,
        strangerChatId,
        aliceId,
        alicePubBase64,
        validToken
      );
    } catch {
      unauthorizedThrew = true;
    }
    assert(unauthorizedThrew === true, "Unauthorized download fails safely without exposing audio");

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("\n========================================");
  console.log(`Phase 2B Voice Tests Completed: ${passed} passed, ${failed} failed.`);
  console.log("========================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2BTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
