import {
  generateECDHKeyPair,
  exportPublicKey,
  isE2EEMediaEnvelope,
  packE2EEMedia,
  unpackE2EEMedia,
  buildMediaAAD,
  encryptMediaBlob,
  decryptMediaEnvelope,
  clearConversationKeyCache,
} from "../lib/crypto.ts";

console.log("Starting Phase 4.1 E2EE Media Cryptographic Test Suite...\n");

async function runMediaCryptoTests() {
  // Setup Node.js mock IndexedDB (same pattern as test-crypto.mjs)
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

  // Generate identity key pairs for Alice, Bob, and Eve
  const alicePair = await generateECDHKeyPair(true);
  const bobPair = await generateECDHKeyPair(true);
  const evePair = await generateECDHKeyPair(true);

  const alicePublicBase64 = await exportPublicKey(alicePair.publicKey);
  const bobPublicBase64 = await exportPublicKey(bobPair.publicKey);
  const evePublicBase64 = await exportPublicKey(evePair.publicKey);

  const chatId = "chat-room-789";
  const senderId = "user-alice";

  // Helper to set current device's identity keypair in mock IndexedDB
  function setActiveIdentity(pair) {
    mockStore.set("chirp_identity_keypair", {
      id: "chirp_identity_keypair",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
    clearConversationKeyCache();
  }

  // Helper to compare two ArrayBuffers for byte-by-byte equality
  function areBuffersEqual(buf1, buf2) {
    if (buf1.byteLength !== buf2.byteLength) return false;
    const v1 = new Uint8Array(buf1);
    const v2 = new Uint8Array(buf2);
    for (let i = 0; i < v1.length; i++) {
      if (v1[i] !== v2[i]) return false;
    }
    return true;
  }

  // ==========================================
  // Test A: Image Encryption & Decryption
  // ==========================================
  console.log("A. Image encryption and decryption");
  const fakeImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04]);
  const imageBlob = new Blob([fakeImageBytes], { type: "image/png" });

  setActiveIdentity(alicePair);
  const imageEnvelope = await encryptMediaBlob(imageBlob, chatId, senderId, bobPublicBase64, "image");

  if (!isE2EEMediaEnvelope(imageEnvelope)) {
    throw new Error("Produced invalid image envelope!");
  }
  if (imageEnvelope.type !== "image" || imageEnvelope.mime !== "image/png") {
    throw new Error("Envelope type or mime mismatch!");
  }

  // Bob decrypts
  setActiveIdentity(bobPair);
  const decryptedImageBlob = await decryptMediaEnvelope(imageEnvelope, chatId, senderId, alicePublicBase64);

  if (decryptedImageBlob.type !== "image/png") {
    throw new Error(`Decrypted image MIME mismatch! Expected 'image/png', got '${decryptedImageBlob.type}'`);
  }
  const decryptedImageBytes = await decryptedImageBlob.arrayBuffer();
  if (!areBuffersEqual(fakeImageBytes.buffer, decryptedImageBytes)) {
    throw new Error("Decrypted image bytes do not match original bytes!");
  }
  console.log("   ✓ Image bytes and MIME perfectly preserved across encryption/decryption.");

  // ==========================================
  // Test B: Audio Encryption & Decryption
  // ==========================================
  console.log("B. Audio encryption and decryption");
  const fakeAudioBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0xaa, 0xbb, 0xcc, 0xdd]);
  const audioBlob = new Blob([fakeAudioBytes], { type: "audio/ogg" });

  setActiveIdentity(alicePair);
  const audioEnvelope = await encryptMediaBlob(audioBlob, chatId, senderId, bobPublicBase64, "audio");

  if (!isE2EEMediaEnvelope(audioEnvelope)) {
    throw new Error("Produced invalid audio envelope!");
  }
  if (audioEnvelope.type !== "audio" || audioEnvelope.mime !== "audio/ogg") {
    throw new Error("Envelope audio type or mime mismatch!");
  }

  // Bob decrypts
  setActiveIdentity(bobPair);
  const decryptedAudioBlob = await decryptMediaEnvelope(audioEnvelope, chatId, senderId, alicePublicBase64);

  if (decryptedAudioBlob.type !== "audio/ogg") {
    throw new Error(`Decrypted audio MIME mismatch! Expected 'audio/ogg', got '${decryptedAudioBlob.type}'`);
  }
  const decryptedAudioBytes = await decryptedAudioBlob.arrayBuffer();
  if (!areBuffersEqual(fakeAudioBytes.buffer, decryptedAudioBytes)) {
    throw new Error("Decrypted audio bytes do not match original bytes!");
  }
  console.log("   ✓ Audio bytes and MIME perfectly preserved across encryption/decryption.");

  // ==========================================
  // Test C: Ciphertext Uniqueness (Fresh IV & CT)
  // ==========================================
  console.log("C. Ciphertext and IV uniqueness");
  setActiveIdentity(alicePair);
  const enc1 = await encryptMediaBlob(imageBlob, chatId, senderId, bobPublicBase64, "image");
  const enc2 = await encryptMediaBlob(imageBlob, chatId, senderId, bobPublicBase64, "image");

  if (enc1.iv === enc2.iv) {
    throw new Error("Repeated IV across separate media encryptions!");
  }
  if (enc1.ct === enc2.ct) {
    throw new Error("Identical ciphertext generated across separate media encryptions!");
  }
  console.log("   ✓ Fresh random 12-byte IV and unique ciphertext for every encryption.");

  // ==========================================
  // Test D: Ciphertext Tampering
  // ==========================================
  console.log("D. Ciphertext tampering detection");
  setActiveIdentity(bobPair);
  let ctTamperFailed = false;
  try {
    const tamperedEnv = { ...enc1 };
    const rawCt = Buffer.from(tamperedEnv.ct, "base64");
    rawCt[0] ^= 0x01; // flip bit
    tamperedEnv.ct = rawCt.toString("base64");
    await decryptMediaEnvelope(tamperedEnv, chatId, senderId, alicePublicBase64);
  } catch {
    ctTamperFailed = true;
  }
  if (!ctTamperFailed) {
    throw new Error("Decryption did NOT fail when ciphertext was tampered with!");
  }
  console.log("   ✓ Ciphertext tampering properly caught and rejected by AES-GCM.");

  // ==========================================
  // Test E: IV Tampering
  // ==========================================
  console.log("E. IV tampering detection");
  let ivTamperFailed = false;
  try {
    const tamperedEnv = { ...enc1 };
    const rawIv = Buffer.from(tamperedEnv.iv, "base64");
    rawIv[0] ^= 0x01; // flip bit
    tamperedEnv.iv = rawIv.toString("base64");
    await decryptMediaEnvelope(tamperedEnv, chatId, senderId, alicePublicBase64);
  } catch {
    ivTamperFailed = true;
  }
  if (!ivTamperFailed) {
    throw new Error("Decryption did NOT fail when IV was tampered with!");
  }
  console.log("   ✓ IV tampering properly caught and rejected.");

  // ==========================================
  // Test F: Wrong Chat ID (AAD mismatch)
  // ==========================================
  console.log("F. Wrong chat ID rejection (AAD mismatch)");
  let wrongChatFailed = false;
  try {
    await decryptMediaEnvelope(enc1, "other-chat-999", senderId, alicePublicBase64);
  } catch {
    wrongChatFailed = true;
  }
  if (!wrongChatFailed) {
    throw new Error("Decryption did NOT fail with wrong chat ID!");
  }
  console.log("   ✓ Wrong chat ID rejected via AAD binding.");

  // ==========================================
  // Test G: Wrong Sender ID (AAD mismatch)
  // ==========================================
  console.log("G. Wrong sender ID rejection (AAD mismatch)");
  let wrongSenderFailed = false;
  try {
    await decryptMediaEnvelope(enc1, chatId, "eve-sender-000", alicePublicBase64);
  } catch {
    wrongSenderFailed = true;
  }
  if (!wrongSenderFailed) {
    throw new Error("Decryption did NOT fail with wrong sender ID!");
  }
  console.log("   ✓ Wrong sender ID rejected via AAD binding.");

  // ==========================================
  // Test H: Wrong Media Type (AAD mismatch)
  // ==========================================
  console.log("H. Wrong media type rejection (AAD mismatch)");
  let wrongTypeFailed = false;
  try {
    // Encrypted as "image", attempt decryption with envelope type changed to "audio"
    const wrongTypeEnv = { ...enc1, type: "audio" };
    await decryptMediaEnvelope(wrongTypeEnv, chatId, senderId, alicePublicBase64);
  } catch {
    wrongTypeFailed = true;
  }
  if (!wrongTypeFailed) {
    throw new Error("Decryption did NOT fail with wrong media type!");
  }
  console.log("   ✓ Changing media type from image to audio rejected via AAD binding.");

  // ==========================================
  // Test I: Wrong MIME (AAD mismatch)
  // ==========================================
  console.log("I. Wrong MIME rejection (AAD mismatch)");
  let wrongMimeFailed = false;
  try {
    // Encrypted with image/png, attempt decryption with envelope mime changed to image/jpeg
    const wrongMimeEnv = { ...enc1, mime: "image/jpeg" };
    await decryptMediaEnvelope(wrongMimeEnv, chatId, senderId, alicePublicBase64);
  } catch {
    wrongMimeFailed = true;
  }
  if (!wrongMimeFailed) {
    throw new Error("Decryption did NOT fail with wrong MIME!");
  }
  console.log("   ✓ Changing MIME type rejected via AAD binding.");

  // ==========================================
  // Test J: Wrong Peer Public Key
  // ==========================================
  console.log("J. Wrong peer public key rejection");
  let wrongPeerFailed = false;
  try {
    // Decrypt using Eve's public key instead of Alice's public key
    await decryptMediaEnvelope(enc1, chatId, senderId, evePublicBase64);
  } catch {
    wrongPeerFailed = true;
  }
  if (!wrongPeerFailed) {
    throw new Error("Decryption did NOT fail with wrong peer public key!");
  }
  console.log("   ✓ Wrong peer public key derivation rejected.");

  // ==========================================
  // Test K: Invalid Envelope Validation
  // ==========================================
  console.log("K. Invalid envelope rejection rules");
  const validMediaEnvelope = {
    e2ee: true,
    v: 1,
    type: "image",
    mime: "image/jpeg",
    iv: "MTIzNDU2Nzg5MDEy", // exactly 12 bytes in Base64
    ct: "c29tZS1jaXBoZXJ0ZXh0", // non-empty Base64
  };

  if (!isE2EEMediaEnvelope(validMediaEnvelope)) {
    throw new Error("Valid media envelope was rejected by isE2EEMediaEnvelope!");
  }

  // Validation checks:
  if (isE2EEMediaEnvelope(null)) throw new Error("Accepted null envelope");
  if (isE2EEMediaEnvelope(undefined)) throw new Error("Accepted undefined envelope");
  if (isE2EEMediaEnvelope("string")) throw new Error("Accepted string envelope");
  if (isE2EEMediaEnvelope([])) throw new Error("Accepted array envelope");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, e2ee: false })) throw new Error("Accepted e2ee: false");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, e2ee: "true" })) throw new Error("Accepted e2ee as string");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, v: 2 })) throw new Error("Accepted unsupported version 2");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, type: "video" })) throw new Error("Accepted invalid type 'video'");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, mime: "" })) throw new Error("Accepted empty mime");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, mime: "text/plain" })) throw new Error("Accepted mime not starting with image/ or audio/");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, mime: "image/" })) {
    // mime starts with image/
  }
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, iv: "short" })) throw new Error("Accepted non-12-byte IV");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, iv: "!@#$%^" })) throw new Error("Accepted non-Base64 IV");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, ct: "" })) throw new Error("Accepted empty ct");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, ct: 12345 })) throw new Error("Accepted non-string ct");
  if (isE2EEMediaEnvelope({ ...validMediaEnvelope, ct: "not base64!" })) throw new Error("Accepted non-Base64 ct");

  console.log("   ✓ All envelope edge cases and validation rules rejected properly without throwing.");

  // ==========================================
  // Test L: Pack / Unpack Roundtrip
  // ==========================================
  console.log("L. Pack/unpack serialization");
  const packed = packE2EEMedia(validMediaEnvelope);
  if (typeof packed !== "string") {
    throw new Error("packE2EEMedia did not return string");
  }

  const unpacked = unpackE2EEMedia(packed);
  if (!unpacked) {
    throw new Error("unpackE2EEMedia returned null for valid packed envelope");
  }
  if (
    unpacked.e2ee !== validMediaEnvelope.e2ee ||
    unpacked.v !== validMediaEnvelope.v ||
    unpacked.type !== validMediaEnvelope.type ||
    unpacked.mime !== validMediaEnvelope.mime ||
    unpacked.iv !== validMediaEnvelope.iv ||
    unpacked.ct !== validMediaEnvelope.ct
  ) {
    throw new Error("Unpacked envelope does not match original!");
  }

  // unpack error cases
  if (unpackE2EEMedia(null) !== null) throw new Error("unpackE2EEMedia did not return null on null");
  if (unpackE2EEMedia("{ invalid json") !== null) throw new Error("unpackE2EEMedia did not return null on invalid JSON");
  if (unpackE2EEMedia("random string") !== null) throw new Error("unpackE2EEMedia did not return null on random string");
  if (unpackE2EEMedia(JSON.stringify({ some: "object" })) !== null) throw new Error("unpackE2EEMedia did not return null on arbitrary object");

  console.log("   ✓ packE2EEMedia and unpackE2EEMedia roundtrip passed.");

  // ==========================================
  // Test M: Large-ish Payload (100 KB)
  // ==========================================
  console.log("M. Moderately sized binary payload (100 KB)");
  const largeBytes = new Uint8Array(100 * 1024);
  // Fill with deterministic pseudo-random bytes
  for (let i = 0; i < largeBytes.length; i++) {
    largeBytes[i] = (i * 31 + 17) & 0xff;
  }
  const largeBlob = new Blob([largeBytes], { type: "image/jpeg" });

  setActiveIdentity(alicePair);
  const largeEnvelope = await encryptMediaBlob(largeBlob, chatId, senderId, bobPublicBase64, "image");

  setActiveIdentity(bobPair);
  const decryptedLargeBlob = await decryptMediaEnvelope(largeEnvelope, chatId, senderId, alicePublicBase64);

  if (decryptedLargeBlob.type !== "image/jpeg") {
    throw new Error("Decrypted 100 KB blob MIME mismatch");
  }
  const decryptedLargeBytes = await decryptedLargeBlob.arrayBuffer();
  if (!areBuffersEqual(largeBytes.buffer, decryptedLargeBytes)) {
    throw new Error("Decrypted 100 KB payload bytes mismatch!");
  }
  console.log("   ✓ 100 KB binary payload encrypted and decrypted with 100% integrity.");

  // ==========================================
  // Test N: AAD Helper Format Check
  // ==========================================
  console.log("N. Media AAD helper format verification");
  const aad = buildMediaAAD("chat123", "user456", "image", "image/jpeg");
  if (aad !== "chirp:e2ee:v1:media:chat123:user456:image:image/jpeg") {
    throw new Error(`Unexpected AAD format: got '${aad}'`);
  }
  console.log("   ✓ Media AAD string conforms exactly to spec: 'chirp:e2ee:v1:media:<chatId>:<senderId>:<type>:<mime>'.");

  console.log("\nAll Phase 4.1 media crypto tests passed successfully! 🎉");
}

runMediaCryptoTests().catch((err) => {
  console.error("\nMedia Crypto Test Failure:", err);
  process.exit(1);
});
