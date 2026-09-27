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

async function runPhase2ATests() {
  console.log("Starting Phase 2A Backblaze B2 Image Integration Test Suite...\n");

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

  const chatId = "test-chat-uuid-1234";
  const strangerChatId = "stranger-chat-uuid-5678";
  const aliceId = "alice-uuid-001";
  const bobId = "bob-uuid-002";
  const validToken = "valid.mock.session.token";

  const rawImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
  const imageBlob = new Blob([rawImageBytes], { type: "image/png" });

  // 1. Image encryption before upload
  console.log("--- TEST 1: Image Encryption before upload ---");
  const binaryEncryptResult = await encryptMediaBlobToBinary(
    imageBlob,
    chatId,
    aliceId,
    bobPubBase64,
    "image"
  );
  assert(binaryEncryptResult.rawEncryptedBytes instanceof ArrayBuffer, "encryptMediaBlobToBinary returns ArrayBuffer");
  assert(binaryEncryptResult.rawEncryptedBytes.byteLength > 0, "Ciphertext binary is non-empty");
  assert(typeof binaryEncryptResult.iv === "string", "IV is Base64 string");
  assert(binaryEncryptResult.mime === "image/png", "MIME type is image/png");
  assert(binaryEncryptResult.fileSize === imageBlob.size, "File size matches original blob");

  // 2. Mock B2 storage & Backend Presigned Endpoints
  const b2BucketMock = new Map();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);

    // Backend presigned-upload endpoint
    if (urlStr.includes("/media/presigned-upload")) {
      const authHeader = options.headers?.Authorization || "";
      if (!authHeader.includes("Bearer valid.mock.session.token")) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }

      const body = JSON.parse(options.body);
      if (body.chatId === "unauthorized-chat") {
        return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });
      }

      const mediaId = "media-" + Math.random().toString(36).substr(2, 9);
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
      const mediaId = urlStr.replace("https://mock-b2.backblazeb2.com/upload/", "");
      if (mediaId.includes("fail-put")) {
        return new Response("Storage error", { status: 500 });
      }
      b2BucketMock.set(mediaId, options.body);
      return new Response("", { status: 200 });
    }

    // B2 Direct Download (GET)
    if (urlStr.startsWith("https://mock-b2.backblazeb2.com/download/")) {
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
    // 3. Stranger Image Upload Flow
    console.log("\n--- TEST 2: Stranger Image Upload Flow (encrypt -> presign -> B2 PUT -> v2 envelope) ---");
    const strangerUpload = await uploadEncryptedMediaToB2(
      imageBlob,
      strangerChatId,
      aliceId,
      bobPubBase64,
      "image",
      validToken
    );
    assert(isE2EEMediaV2Envelope(strangerUpload.envelope), "Upload returns valid E2EEMediaV2Envelope");
    assert(strangerUpload.envelope.v === 2, "Envelope version is 2");
    assert(strangerUpload.envelope.type === "image", "Envelope type is image");
    assert(b2BucketMock.has(strangerUpload.envelope.mediaId), "Raw encrypted bytes successfully stored in B2 mock");

    // 4. Friend Image Upload Flow
    console.log("\n--- TEST 3: Friend Image Upload Flow ---");
    const friendUpload = await uploadEncryptedMediaToB2(
      imageBlob,
      chatId,
      aliceId,
      bobPubBase64,
      "image",
      validToken
    );
    assert(isE2EEMediaV2Envelope(friendUpload.envelope), "Friend upload returns valid E2EEMediaV2Envelope");
    assert(friendUpload.envelope.v === 2, "Friend envelope version is 2");

    // 5. Socket.IO emit only after successful PUT
    console.log("\n--- TEST 4: Socket.IO message emitted only after successful PUT ---");
    let socketEmitted = false;
    let emittedPayload = null;

    const mockSendStrangerImage = async (file, caption) => {
      const { envelope } = await uploadEncryptedMediaToB2(
        file,
        strangerChatId,
        aliceId,
        bobPubBase64,
        "image",
        validToken
      );
      // Emit Socket.IO
      socketEmitted = true;
      emittedPayload = {
        envelope,
        clientId: "client-123",
        text: caption || undefined,
      };
    };

    await mockSendStrangerImage(imageBlob, "Check out this photo!");
    assert(socketEmitted === true, "Socket message emitted after successful B2 PUT");
    assert(emittedPayload.text === "Check out this photo!", "Caption preserved in top-level text field");
    assert(isE2EEMediaV2Envelope(emittedPayload.envelope), "Emitted envelope is v2 B2 reference");

    // 6. Upload failure -> No Socket.IO emit
    console.log("\n--- TEST 5: Upload Failure -> No Socket.IO emit ---");
    let failedSocketEmitted = false;
    let uploadThrewError = false;

    const mockFailedSend = async () => {
      try {
        // Use unauthorized chat to trigger 403 presign failure
        const { envelope } = await uploadEncryptedMediaToB2(
          imageBlob,
          "unauthorized-chat",
          aliceId,
          bobPubBase64,
          "image",
          validToken
        );
        failedSocketEmitted = true;
      } catch (err) {
        uploadThrewError = true;
      }
    };

    await mockFailedSend();
    assert(uploadThrewError === true, "Upload threw error on presign failure");
    assert(failedSocketEmitted === false, "Socket.IO message was NOT emitted on upload failure");

    // 7. v2 Image Download & Decryption
    console.log("\n--- TEST 6: v2 Image Download & Decryption (Receiver Flow) ---");
    setActiveIdentity(bobKeyPair);
    const downloadedBlob = await downloadAndDecryptMediaFromB2(
      strangerUpload.envelope,
      strangerChatId,
      aliceId,
      alicePubBase64,
      validToken
    );
    assert(downloadedBlob instanceof Blob, "downloadAndDecryptMediaFromB2 returns Blob");
    assert(downloadedBlob.type === "image/png", "Decrypted Blob MIME is image/png");
    const decryptedBytes = new Uint8Array(await downloadedBlob.arrayBuffer());
    assert(decryptedBytes.length === rawImageBytes.length, "Decrypted bytes match length");
    let match = true;
    for (let i = 0; i < rawImageBytes.length; i++) {
      if (decryptedBytes[i] !== rawImageBytes[i]) match = false;
    }
    assert(match, "Decrypted image bytes match original exactly");

    // 8. v1/v2 Coexistence & History
    console.log("\n--- TEST 7: v1 and v2 Coexistence & History ---");
    setActiveIdentity(aliceKeyPair);
    const v1Envelope = await encryptMediaBlob(imageBlob, chatId, aliceId, bobPubBase64, "image");
    assert(isE2EEMediaEnvelope(v1Envelope), "v1 envelope passes isE2EEMediaEnvelope");
    assert(isE2EEAnyMediaEnvelope(v1Envelope), "v1 envelope passes isE2EEAnyMediaEnvelope");
    assert(isE2EEAnyMediaEnvelope(strangerUpload.envelope), "v2 envelope passes isE2EEAnyMediaEnvelope");

    const unpackedV1 = unpackE2EEAnyMedia(JSON.stringify(v1Envelope));
    const unpackedV2 = unpackE2EEAnyMedia(JSON.stringify(strangerUpload.envelope));
    assert(unpackedV1 && unpackedV1.v === 1, "unpackE2EEAnyMedia successfully unpacks v1 history");
    assert(unpackedV2 && unpackedV2.v === 2, "unpackE2EEAnyMedia successfully unpacks v2 history");

    // Decrypt both as Bob
    setActiveIdentity(bobKeyPair);
    const v1Decrypted = await decryptMediaEnvelope(unpackedV1, chatId, aliceId, alicePubBase64);
    assert(v1Decrypted.size === imageBlob.size, "v1 history decodes correctly");

    const v2Decrypted = await downloadAndDecryptMediaFromB2(
      unpackedV2,
      strangerChatId,
      aliceId,
      alicePubBase64,
      validToken
    );
    assert(v2Decrypted.size === imageBlob.size, "v2 history decodes correctly");

    // 9. Unauthorized Download Does Not Expose Media
    console.log("\n--- TEST 8: Unauthorized download does not expose media ---");
    let downloadThrew = false;
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
      downloadThrew = true;
    }
    assert(downloadThrew, "Unauthorized presigned download request fails safely without exposing data");

    // 10. Photo Captions Behavior
    console.log("\n--- TEST 9: Photo Captions Behavior ---");
    assert(emittedPayload.text === "Check out this photo!", "Sender transmits caption in top-level text field");
    assert(!("text" in emittedPayload.envelope), "Caption is NOT inside media envelope");
    assert(!("captionEnvelope" in emittedPayload), "No captionEnvelope created");

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("\n========================================");
  console.log(`Phase 2A Tests Completed: ${passed} passed, ${failed} failed.`);
  console.log("========================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2ATests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
