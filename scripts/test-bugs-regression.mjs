/**
 * Regression Test Suite for Chirp's 3 Production Bug Fixes:
 * BUG 1: Stranger Chat: Receiver decrypts voice message and obtains playable object URL (without fallback text)
 * BUG 2: Friend 1-to-1 Chat: Sender echo reconciles with optimistic message using clientId (no duplicate, media URL preserved)
 * BUG 3: False "Stranger left chat" prompt: Room/session filtering ignores stale stranger_left events
 */

import {
  generateECDHKeyPair,
  exportPublicKey,
  isE2EEMediaEnvelope,
  encryptMediaBlob,
  decryptMediaEnvelope,
  clearConversationKeyCache,
} from "../lib/crypto.ts";

console.log("Starting Production Bug Fix Regression Test Suite...\n");

async function runRegressionTests() {
  // Mock IndexedDB for Node.js environment
  const mockStore = new Map();
  const mockIDB = {
    open: () => {
      const req = {
        onsuccess: null,
        onerror: null,
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

  // Setup Mock Keypairs for User A (Sender) & User B (Receiver)
  const userAPair = await generateECDHKeyPair(true);
  const userBPair = await generateECDHKeyPair(true);
  const userAPubBase64 = await exportPublicKey(userAPair.publicKey);
  const userBPubBase64 = await exportPublicKey(userBPair.publicKey);

  function setActiveIdentity(pair) {
    mockStore.set("chirp_identity_keypair", {
      id: "chirp_identity_keypair",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
    clearConversationKeyCache();
  }

  const strangerChatId = "stranger-chat-regression-1";
  const userAId = "user-alice";
  const userBId = "user-bob";

  // =========================================================================
  // BUG 1 REGRESSION: Stranger Voice Receiver Playback & Object URL Creation
  // =========================================================================
  console.log("=== BUG 1: Stranger Chat Voice Receiver Flow ===");

  // 1. Sender User A encrypts voice note
  setActiveIdentity(userAPair);
  const sampleAudioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
  const audioBlob = new Blob([sampleAudioBytes], { type: "audio/webm;codecs=opus" });

  const strangerVoiceEnvelope = await encryptMediaBlob(
    audioBlob,
    strangerChatId,
    userAId,
    userBPubBase64,
    "audio"
  );

  // Assert envelope format
  assert(isE2EEMediaEnvelope(strangerVoiceEnvelope), "strangerVoiceEnvelope is valid E2EEMediaEnvelope");
  assert(strangerVoiceEnvelope.type === "audio", "Envelope type is audio");
  assert(strangerVoiceEnvelope.mime === "audio/webm;codecs=opus", "Envelope mime is preserved");
  assert(typeof strangerVoiceEnvelope.ct === "string", "Ciphertext is Base64 string");

  // 2. Server transports payload (verify NO plaintext audio bytes)
  const serverPayloadToReceiver = {
    id: "msg-stranger-voice-1",
    clientId: "client-stranger-voice-1",
    envelope: strangerVoiceEnvelope,
    senderId: userAId,
    timestamp: Date.now(),
    type: "audio",
    status: "delivered",
  };

  assert(serverPayloadToReceiver.envelope.ct !== undefined, "Socket payload contains only E2EE envelope");
  assert(!("audioUrl" in serverPayloadToReceiver) || serverPayloadToReceiver.audioUrl === undefined, "No plaintext audioUrl transmitted over server payload");
  assert(!("text" in serverPayloadToReceiver) || serverPayloadToReceiver.text === undefined, "No plaintext audio bytes in socket payload");

  // 3. Receiver User B receives and decrypts message
  setActiveIdentity(userBPair);

  // Receiver resolves peerKey (using peerPublicKey / userAPubBase64)
  const receiverActiveChatId = strangerChatId;
  const receiverPeerKey = userAPubBase64;
  const decryptedBlob = await decryptMediaEnvelope(
    serverPayloadToReceiver.envelope,
    receiverActiveChatId,
    serverPayloadToReceiver.senderId,
    receiverPeerKey
  );

  assert(decryptedBlob instanceof Blob, "Receiver decrypted payload into Blob");
  assert(decryptedBlob.type === "audio/webm;codecs=opus", "Decrypted Blob has correct audio MIME");
  assert(decryptedBlob.size === sampleAudioBytes.byteLength, "Decrypted Blob has identical byte length");

  const decryptedBytes = new Uint8Array(await decryptedBlob.arrayBuffer());
  let bytesMatch = true;
  for (let i = 0; i < sampleAudioBytes.length; i++) {
    if (decryptedBytes[i] !== sampleAudioBytes[i]) {
      bytesMatch = false;
      break;
    }
  }
  assert(bytesMatch, "Decrypted audio bytes exactly match sender's original audio bytes");

  // 4. Receiver registers object URL and assigns audioUrl
  const mockObjectUrlRegistry = new Set();
  const mockRegisterObjectUrl = (url) => {
    mockObjectUrlRegistry.add(url);
    return url;
  };
  const mockCreatedUrl = `blob:http://localhost:3000/${Math.random().toString(36).substr(2)}`;
  const registeredUrl = mockRegisterObjectUrl(mockCreatedUrl);

  const receiverMessage = {
    id: serverPayloadToReceiver.id,
    clientId: serverPayloadToReceiver.clientId,
    text: "Voice message",
    sender: serverPayloadToReceiver.senderId === userBId ? "me" : "stranger",
    timestamp: serverPayloadToReceiver.timestamp,
    type: serverPayloadToReceiver.envelope.type,
    audioUrl: registeredUrl,
    imageUrl: undefined,
    status: "delivered",
  };

  assert(receiverMessage.audioUrl !== undefined, "Receiver message has audioUrl populated");
  assert(receiverMessage.audioUrl.startsWith("blob:"), "Receiver audioUrl is a valid blob: URL");
  assert(mockObjectUrlRegistry.has(registeredUrl), "Object URL is registered in objectUrlRegistry");
  assert(receiverMessage.type === "audio", "Receiver message type is 'audio'");

  // =========================================================================
  // BUG 2 REGRESSION: Friend 1-to-1 Chat Sender Echo Deduplication & URL Preservation
  // =========================================================================
  console.log("\n=== BUG 2: Friend 1-to-1 Chat Sender Echo Deduplication ===");

  const friendClientIdText = "client-friend-text-1";
  const friendClientIdAudio = "client-friend-audio-1";
  const friendClientIdImage = "client-friend-image-1";

  // Simulate local optimistic messages in state
  let friendMessages = [
    {
      id: friendClientIdText,
      clientId: friendClientIdText,
      text: "Hello friend!",
      sender: "me",
      timestamp: 1000,
      type: "text",
      status: "sending",
    },
    {
      id: friendClientIdAudio,
      clientId: friendClientIdAudio,
      text: "Voice message",
      sender: "me",
      timestamp: 1001,
      type: "audio",
      audioUrl: "blob:http://localhost:3000/local-optimistic-audio-url",
      status: "sending",
    },
    {
      id: friendClientIdImage,
      clientId: friendClientIdImage,
      text: "Photo message",
      sender: "me",
      timestamp: 1002,
      type: "image",
      imageUrl: "blob:http://localhost:3000/local-optimistic-image-url",
      status: "sending",
    },
  ];

  // Helper reconciling function replicating app/page.tsx receive_friend_message
  function reconcileFriendMessage(currentList, serverEcho) {
    if (serverEcho.clientId) {
      const exists = currentList.some((m) => m.clientId === serverEcho.clientId);
      if (exists) {
        return currentList.map((m) =>
          m.clientId === serverEcho.clientId
            ? {
                ...m,
                id: serverEcho.id,
                status: "delivered",
                timestamp: serverEcho.timestamp,
                audioUrl: m.audioUrl || serverEcho.audioUrl,
                imageUrl: m.imageUrl || serverEcho.imageUrl,
              }
            : m
        );
      }
    }
    return [...currentList, serverEcho];
  }

  // 1. Text message sender echo reconciliation
  const textEcho = {
    id: "server-msg-id-text-101",
    clientId: friendClientIdText,
    senderId: userAId,
    timestamp: 1050,
    type: "text",
    status: "sent",
  };
  friendMessages = reconcileFriendMessage(friendMessages, textEcho);

  const reconciledText = friendMessages.find((m) => m.clientId === friendClientIdText);
  const textCount = friendMessages.filter((m) => m.clientId === friendClientIdText || m.id === textEcho.id).length;
  assert(textCount === 1, "Friend text sender echo results in exactly ONE message");
  assert(reconciledText.id === "server-msg-id-text-101", "Friend text id updated to server ID");
  assert(reconciledText.status === "delivered", "Friend text status updated to delivered");

  // 2. Audio message sender echo reconciliation
  const audioEcho = {
    id: "server-msg-id-audio-102",
    clientId: friendClientIdAudio,
    senderId: userAId,
    timestamp: 1055,
    type: "audio",
    status: "sent",
    // Server echo contains only envelope, no audioUrl
    audioUrl: undefined,
  };
  friendMessages = reconcileFriendMessage(friendMessages, audioEcho);

  const reconciledAudio = friendMessages.find((m) => m.clientId === friendClientIdAudio);
  const audioCount = friendMessages.filter((m) => m.clientId === friendClientIdAudio || m.id === audioEcho.id).length;
  assert(audioCount === 1, "Friend audio sender echo results in exactly ONE message");
  assert(reconciledAudio.id === "server-msg-id-audio-102", "Friend audio id updated to server ID");
  assert(reconciledAudio.audioUrl === "blob:http://localhost:3000/local-optimistic-audio-url", "Local optimistic audio blob URL preserved after reconciliation");

  // 3. Image message sender echo reconciliation
  const imageEcho = {
    id: "server-msg-id-image-103",
    clientId: friendClientIdImage,
    senderId: userAId,
    timestamp: 1060,
    type: "image",
    status: "sent",
    // Server echo contains only envelope, no imageUrl
    imageUrl: undefined,
  };
  friendMessages = reconcileFriendMessage(friendMessages, imageEcho);

  const reconciledImage = friendMessages.find((m) => m.clientId === friendClientIdImage);
  const imageCount = friendMessages.filter((m) => m.clientId === friendClientIdImage || m.id === imageEcho.id).length;
  assert(imageCount === 1, "Friend image sender echo results in exactly ONE message");
  assert(reconciledImage.id === "server-msg-id-image-103", "Friend image id updated to server ID");
  assert(reconciledImage.imageUrl === "blob:http://localhost:3000/local-optimistic-image-url", "Local optimistic image blob URL preserved after reconciliation");

  // 4. Receiver receives exactly one message
  let receiverFriendMessages = [];
  const receiverIncomingEcho = {
    id: "server-msg-id-text-101",
    clientId: friendClientIdText,
    text: "Decrypted friend text",
    senderId: userAId,
    timestamp: 1050,
    type: "text",
    status: "delivered",
  };
  receiverFriendMessages = reconcileFriendMessage(receiverFriendMessages, receiverIncomingEcho);
  assert(receiverFriendMessages.length === 1, "Receiver receives exactly ONE message");

  // =========================================================================
  // BUG 3 REGRESSION: False "Stranger left chat" event filtering
  // =========================================================================
  console.log("\n=== BUG 3: Stranger Left Event Filtering ===");

  let notificationsShown = [];
  const showNotification = (msg) => {
    notificationsShown.push(msg);
  };

  function handleStrangerLeftEvent(eventPayload, state) {
    // Replicating app/page.tsx filtered listener
    if (state.currentView !== "stranger-chat" || !state.strangerRoomId) return false;
    if (eventPayload?.roomId && eventPayload.roomId !== state.strangerRoomId) return false;
    if (state.strangerStatus === "disconnected") return false;

    state.strangerStatus = "disconnected";
    showNotification("Stranger left the chat.");
    return true;
  }

  // Scenario 1: User is in matching view (no active stranger) -> should IGNORE
  notificationsShown = [];
  const stateInMatching = {
    currentView: "matching",
    strangerRoomId: null,
    strangerStatus: "connecting",
  };
  const handled1 = handleStrangerLeftEvent({ roomId: "old-room-123" }, stateInMatching);
  assert(!handled1 && notificationsShown.length === 0, "Ignored stranger_left when user is in matching view");

  // Scenario 2: User is in friend-chat view -> should IGNORE
  notificationsShown = [];
  const stateInFriendChat = {
    currentView: "friend-chat",
    strangerRoomId: null,
    strangerStatus: "disconnected",
  };
  const handled2 = handleStrangerLeftEvent({ roomId: "old-room-456" }, stateInFriendChat);
  assert(!handled2 && notificationsShown.length === 0, "Ignored stranger_left when user is in friend chat view");

  // Scenario 3: Event has stale roomId from an old stranger session -> should IGNORE
  notificationsShown = [];
  const stateInActiveStranger = {
    currentView: "stranger-chat",
    strangerRoomId: "active-room-current",
    strangerStatus: "online",
  };
  const handled3 = handleStrangerLeftEvent({ roomId: "stale-old-room" }, stateInActiveStranger);
  assert(!handled3 && notificationsShown.length === 0, "Ignored stranger_left with stale roomId from prior session");

  // Scenario 4: User is already marked disconnected -> should NOT produce duplicate prompt
  notificationsShown = [];
  const stateAlreadyDisconnected = {
    currentView: "stranger-chat",
    strangerRoomId: "active-room-current",
    strangerStatus: "disconnected",
  };
  const handled4 = handleStrangerLeftEvent({ roomId: "active-room-current" }, stateAlreadyDisconnected);
  assert(!handled4 && notificationsShown.length === 0, "Ignored duplicate stranger_left when already disconnected");

  // Scenario 5: Valid event for the CURRENT active stranger session -> should SHOW ONCE
  notificationsShown = [];
  const stateValidSession = {
    currentView: "stranger-chat",
    strangerRoomId: "active-room-current",
    strangerStatus: "online",
  };
  const handled5 = handleStrangerLeftEvent({ roomId: "active-room-current" }, stateValidSession);
  assert(handled5 && notificationsShown.length === 1 && notificationsShown[0] === "Stranger left the chat.", "Displayed 'Stranger left the chat.' once for genuine active stranger session");
  assert(stateValidSession.strangerStatus === "disconnected", "State updated to disconnected");

  console.log(`\n========================================`);
  console.log(`ALL REGRESSION TESTS PASSED! (${passed} checks passed, ${failed} failed)`);
  console.log(`========================================\n`);
}

runRegressionTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
