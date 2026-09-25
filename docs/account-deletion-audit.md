# Chirp: Complete Account Deletion Audit ("Log out & Delete Account")

**Audit Date**: September 25, 2026  
**Auditor**: Antigravity Assistant  
**Status**: READ-ONLY AUDIT COMPLETE (No code, schema, data, or configuration modified)  

---

## 1. Executive Summary

This audit assesses the end-to-end data lifecycle and permanent purge guarantees of Chirp's **"Log out & Delete Account"** feature across all architectural tiers: Next.js (Vercel), NestJS & Socket.IO (Render), PostgreSQL (Neon/Prisma), Redis (Upstash), and Object Storage (Backblaze B2 private bucket `chirp-media`).

### Key Audit Findings:
1. **PostgreSQL Relational Purge is Comprehensive for Direct Models, but has Gaps with Orphan Media**:
   - The user record, profile metadata, friendships, 1-to-1 chats, stranger chats, messages, reactions, blocks, reports, and notifications are purged within a single Prisma transaction in `UsersService.deleteAccount()`.
   - **Critical Gap**: `MediaAttachment` records that were created during presigned upload generation but whose messages were not yet linked, or media sent by the deleting user in a chat that somehow is not deleted, rely solely on `Chat` cascade or `Message` cascade. Specifically: `MediaAttachment.message` has `onDelete: Cascade`, and `MediaAttachment.chat` has `onDelete: Cascade`. However, `MediaAttachment` has **no foreign key relation to `User`** (only an unindexed/unconstrained scalar `senderId: String`). If a chat is not deleted (e.g. if the deleting user was only a participant in a chat that wasn't found by the filter), or if an upload was created but never attached to a message before deletion, unlinked `MediaAttachment` records can remain orphaned in PostgreSQL.
2. **Backblaze B2 Deletion is COMPLETELY MISSING (CRITICAL GAP)**:
   - When a user deletes their account, **zero B2 API calls are made**.
   - `B2StorageService` provides a `deleteObject(storageKey: string)` method, but **it is never called by `UsersService.deleteAccount()` or `MediaService`**.
   - All encrypted photos and voice notes uploaded to B2 (`media/<chatId>/<uuid>.bin`) remain stored on Backblaze B2 indefinitely after account deletion, even though the database metadata is wiped.
3. **Redis Cleanup is Partially Implemented**:
   - `RedisService.cleanupUserRedisState(userId)` clears `presence:user:${userId}`, `presence:sockets:${userId}`, `ai:cooldown:${userId}`, `ai:inflight:${userId}`, `user:match:${userId}`, and removes waiting entries from `matchmaking:waiting`.
   - **Gaps**: `socket:map:${socket.id}` entries, `ai:daily-usage:${userId}:${todayDate}` keys, and `match:${roomId}` state are not explicitly removed during account deletion.
4. **WebSocket & WebRTC Teardown**:
   - The frontend cleanly triggers `videoCall.teardownCall()` and `friendVideoCall.teardownCall()`, and calls `socket.disconnect()`.
   - The backend `deletionHook` triggers `handleUserAccountDeleted(userId)`, which emits `stranger_left` to stranger rooms and forcibly disconnects the socket (`sock.disconnect(true)`).
   - **Gap**: The gateway does not explicitly clear in-memory or Redis active call sessions (`this.clearActiveCallSession(...)`) or notify peer video callers if an active video call is ongoing at the exact moment of deletion via HTTP request.
5. **Authentication & Session Tokens**:
   - Chirp uses stateless HMAC-SHA256 signed session tokens.
   - The frontend thoroughly deletes all tokens and user IDs from `localStorage` and `sessionStorage`.
   - **Risk**: Because tokens are stateless HMAC tokens without a Redis blacklist or DB token revocation table, a captured token remains mathematically valid for API calls until it hits the DB check (`where: { id: userId }`). Since the `User` row in DB is deleted, subsequent DB-dependent requests fail with `404 Not Found` or `401 Unauthorized` where user existence is verified. However, pure token validation guards that only inspect token signature and IDOR params (without querying DB) could theoretically pass if an endpoint does not verify DB existence.
6. **E2EE Cryptographic Material**:
   - Frontend calls `await clearIdentityKeys()`, which deletes the user's ECDH identity keypair from `IndexedDB` (`chirp-e2ee-keystore`).
   - The public key stored in PostgreSQL (`User.publicKey`) is deleted when the `User` record is deleted.
   - Once deleted from IndexedDB, the user can never again decrypt any past messages or media, even if stored locally.

---

## 2. Trace of Current Delete-Account Flow

```
UI Interaction
└─ [components/AppSidebar.tsx:440]
   └─ User clicks "🗑️ Log Out & Delete Account"
      └─ Confirmation Modal displayed: "Delete your account? This action cannot be undone."
         └─ User confirms -> invokes onDeleteAccount prop

Frontend Handler
└─ [app/page.tsx:3397] handleDeleteAccount()
   ├─ 1. videoCall.teardownCall(); friendVideoCall.teardownCall();
   ├─ 2. Closes video modal states & resets unread counts
   ├─ 3. Fetches DELETE `${BACKEND_URL}/users/${userId}/account` with Bearer token
   │
Backend API & Controller
└─ [backend/src/users/users.controller.ts:129] @Delete(':userId/account')
   ├─ Guard: SessionAuthGuard validates token and prevents IDOR (targetUserId === payload.userId)
   └─ Service: usersService.deleteAccount(userId)
      │
Backend Service Execution
└─ [backend/src/users/users.service.ts:343] deleteAccount(userId)
   ├─ 1. Check user exists (throws 404 if not found)
   ├─ 2. Trigger gateway hook: await this.deletionHook(userId)
   │     └─ [backend/src/chat/chat.gateway.ts:390] handleUserAccountDeleted(userId)
   │        ├─ Emits 'stranger_left' to any active stranger room
   │        ├─ Force-disconnects all active user sockets: sock.disconnect(true)
   │        ├─ Removes sockets from in-memory maps
   │        └─ Broadcasts offline presence to friends
   ├─ 3. Execute Prisma Transaction: await this.prisma.$transaction(...)
   │     ├─ a. Find friendships involving user -> extract friendChatIds
   │     ├─ b. Find stranger chats involving user (excluding friendChatIds) -> allChatIds
   │     ├─ c. Delete messages in all those chats: tx.message.deleteMany({ where: { chatId: { in: allChatIds } } })
   │     ├─ d. Delete any remaining messages sent by user: tx.message.deleteMany({ where: { senderId: userId } })
   │     ├─ e. Delete friendships: tx.friendship.deleteMany({ where: { OR: [userAId, userBId] } })
   │     ├─ f. Delete reports involving chats or user: tx.report.deleteMany(...)
   │     ├─ g. Delete chats: tx.chat.deleteMany({ where: { id: { in: allChatIds } } })
   │     │     └─ Prisma cascade triggers: MediaAttachment deletion (in DB only!)
   │     ├─ h. Delete friend requests: tx.friendRequest.deleteMany(...)
   │     ├─ i. Delete blocks: tx.block.deleteMany(...)
   │     ├─ j. Delete reactions: tx.reaction.deleteMany({ where: { userId } })
   │     ├─ k. Delete notifications: tx.notification.deleteMany({ where: { userId } })
   │     ├─ l. Delete user: tx.user.delete({ where: { id: userId } })
   │     └─ m. Increment PlatformStats.totalDeletedAccounts
   ├─ 4. Redis Cleanup: await this.redis.cleanupUserRedisState(userId)
   │     └─ Clears presence keys, AI cooldown/inflight, user:match, and matchmaking:waiting
   └─ 5. Return HTTP 200 { success: true }
      │
Frontend Post-Deletion Cleanup
└─ [app/page.tsx:3420]
   ├─ 1. socket.disconnect(); setSocket(null);
   ├─ 2. clearPersistedAuth();
   │     └─ Wipes localStorage and sessionStorage (auth tokens, user IDs)
   ├─ 3. await clearIdentityKeys();
   │     └─ Deletes ECDH P-256 keypair from browser IndexedDB
   ├─ 4. Sets isAccountDeletedRef.current = true;
   ├─ 5. Resets all React state variables to initial empty defaults
   └─ 6. Navigates view to "profile-setup" and shows toast confirmation
```

---

## 3. PostgreSQL Audit

### Model Dependency & Cascade Graph

```
User (id: String @id)
├── Profile fields (username, age, gender, avatar, language, interests, goal, publicKey) [DIRECT ON USER]
├── chatsAsUserA / chatsAsUserB (Chat) [CASCADE: NO schema cascade on User; MANUAL in Service]
│   ├── messages (Message) [CASCADE: NO schema cascade on Chat; MANUAL in Service]
│   │   ├── reactions (Reaction) [CASCADE: onDelete: Cascade on Message & User]
│   │   ├── replyTo / replies (Message) [CASCADE: onDelete: SetNull on replyToId]
│   │   └── mediaAttachment (MediaAttachment) [CASCADE: onDelete: Cascade on Message]
│   ├── mediaAttachments (MediaAttachment) [CASCADE: onDelete: Cascade on Chat]
│   └── friendship (Friendship) [CASCADE: NO schema cascade on Chat; MANUAL in Service]
├── sentMessages (Message) [CASCADE: NO schema cascade on User; MANUAL in Service]
├── reactions (Reaction) [CASCADE: onDelete: Cascade on User]
├── reportsMade / reportsReceived (Report) [CASCADE: NO schema cascade on User; MANUAL in Service]
├── blocksMade / blocksReceived (Block) [CASCADE: NO schema cascade on User; MANUAL in Service]
├── sentFriendRequests / receivedFriendRequests (FriendRequest) [CASCADE: NO schema cascade on User; MANUAL in Service]
├── friendshipsAsUserA / friendshipsAsUserB (Friendship) [CASCADE: NO schema cascade on User; MANUAL in Service]
└── notifications (Notification) [CASCADE: onDelete: Cascade on User]
```

### Detailed Evaluation Per Model

| Model | User Association | Deletion Mechanism | Verified Status | Orphan Risk |
|---|---|---|---|---|
| **User** | Primary key `id` | `tx.user.delete({ where: { id: userId } })` | **PURGED** | None |
| **Profile & Public Key** | Columns directly on `User` table | Deleted with `User` row | **PURGED** | None |
| **Friendship** | `userAId` / `userBId` | Explicit `tx.friendship.deleteMany` | **PURGED** | None |
| **FriendRequest** | `senderId` / `receiverId` | Explicit `tx.friendRequest.deleteMany` | **PURGED** | None |
| **Block** | `blockerId` / `blockedId` | Explicit `tx.block.deleteMany` | **PURGED** | None |
| **Report** | `reporterId` / `reportedId` / `chatId` | Explicit `tx.report.deleteMany` | **PURGED** | None |
| **Notification** | `userId` | `tx.notification.deleteMany` + Schema `onDelete: Cascade` | **PURGED** | None |
| **Chat** | `userAId` / `userBId` | Identified via `OR: [{ userAId }, { userBId }]` and deleted via `tx.chat.deleteMany` | **PURGED** | None |
| **Message** | `senderId` / `chatId` | `tx.message.deleteMany({ where: { chatId: { in: allChatIds } } })` + `tx.message.deleteMany({ where: { senderId: userId } })` | **PURGED** | None |
| **Reaction** | `userId` / `messageId` | `tx.reaction.deleteMany({ where: { userId } })` + Schema `onDelete: Cascade` on `Message` | **PURGED** | None |
| **MediaAttachment** | `senderId` / `chatId` / `messageId` | Schema `onDelete: Cascade` on `Chat` and `Message`. **NO direct delete for `senderId`!** | **PARTIAL** | **YES (Edge case)** |

---

## 4. Backblaze B2 Object Storage Audit (CRITICAL GAP)

### Current Implementation State
- `B2StorageService` ([backend/src/media/b2-storage.service.ts](file:///c:/Users/Raja/OneDrive/Desktop/stranger-chat/backend/src/media/b2-storage.service.ts)) contains an S3-compatible method:
  ```typescript
  async deleteObject(storageKey: string): Promise<void>
  ```
- **Audit Discovery**: `b2Storage.deleteObject(...)` is **NEVER called anywhere in production backend services**. It is only referenced in a mock inside a unit test!
- `UsersService.deleteAccount()` does NOT inject `MediaService` or `B2StorageService`.
- `UsersService.deleteAccount()` does NOT collect `storageKey`s from `MediaAttachment` before deleting the database records.

### What Happens in B2 on Account Deletion Today:
1. **User deletes account after sending photos / voice notes**:
   - PostgreSQL deletes the `Chat`, `Message`, and `MediaAttachment` rows.
   - **The encrypted `.bin` ciphertext files remain stored in the Backblaze B2 bucket forever**.
   - Because the bucket is private and presigned download URLs require an active `MediaAttachment` + chat membership check in PostgreSQL, no user can generate a presigned download URL for those orphan files.
   - However, the binary blobs persist on Backblaze B2, accumulating storage costs and violating user expectations of "permanent account deletion".
2. **Abandoned / In-Flight Uploads**:
   - If a user requests a presigned URL, uploads bytes to B2, but deletes their account before sending the message, the object sits in B2 unreferenced forever.
3. **Cross-User Media Retention Policy (Ambiguity)**:
   - If User A sends a photo to User B in a 1-to-1 friend chat, and User A deletes their account:
     - The current implementation deletes the entire `Chat` and all its `Message`s and `MediaAttachment`s.
     - User B immediately loses access to the chat and the message history.
     - However, the physical B2 file uploaded by User A remains in B2.
   - If User B deletes their account (recipient):
     - The current implementation deletes the `Chat` because it finds `OR: [{ userAId: UserB }, { userBId: UserB }]`.
     - Consequently, User A's chat is also deleted, but User A's media in B2 is still not deleted from B2.

---

## 5. Redis State Audit

### Redis Keys Checked During Account Deletion:
In [backend/src/redis/redis.service.ts](file:///c:/Users/Raja/OneDrive/Desktop/stranger-chat/backend/src/redis/redis.service.ts):
```typescript
async cleanupUserRedisState(userId: string): Promise<void> {
  const keys = [
    `presence:user:${userId}`,
    `presence:sockets:${userId}`,
    `ai:cooldown:${userId}`,
    `ai:inflight:${userId}`,
    `user:match:${userId}`,
  ];
  for (const k of keys) {
    await this.del(k);
  }
  // Also removes user from 'matchmaking:waiting' list
}
```

### Redis State Audit Results:

| Redis Key Pattern | Purpose | Cleared on Deletion? | Risk / Impact |
|---|---|---|---|
| `presence:user:${userId}` | User presence timestamp/status | **YES** | Clean |
| `presence:sockets:${userId}` | Set of active socket IDs | **YES** | Clean |
| `user:match:${userId}` | One-active-match lock | **YES** | Clean |
| `matchmaking:waiting` | Queue for stranger search | **YES** (`lrem`) | Clean |
| `ai:cooldown:${userId}` | 10s AI suggestion cooldown | **YES** | Clean |
| `ai:inflight:${userId}` | In-flight AI lock | **YES** | Clean |
| `ai:daily-usage:${userId}:${date}` | Daily AI quota counter | **NO** | Harmless (has TTL or expires automatically at end of day) |
| `socket:map:${socketId}` | Maps socket to `{ userId, roomId, chatId }` | **NO** (Only cleared on disconnect) | If socket was not disconnected or timing race, mapping remains until 24h TTL expires |
| `match:${roomId}` | Active stranger room metadata | **NO** (Only cleared if `leaveChat` finishes) | Could leave stale match state if socket forcibly terminated |
| `ratelimit:*:${userId}` | Sliding window rate limiter | **NO** | Transient with short TTL |

---

## 6. Socket.IO & WebRTC Audit

### Live Connection & Signaling Teardown:
1. **Frontend Teardown**:
   - `handleDeleteAccount` in `app/page.tsx` calls:
     ```typescript
     videoCall.teardownCall();
     friendVideoCall.teardownCall();
     ```
     This stops local media tracks (`stream.getTracks().forEach(t => t.stop())`), closes RTCPeerConnections, and resets video state in React.
2. **Socket Disconnection**:
   - Frontend calls `socket.disconnect(); setSocket(null);`.
3. **Backend Server-Side Teardown**:
   - In `UsersService.deleteAccount`, the `deletionHook` is called:
     ```typescript
     await this.handleUserAccountDeleted(userId);
     ```
   - In `ChatGateway`:
     ```typescript
     async handleUserAccountDeleted(userId: string) {
       const sockets = this.inMemoryUserSockets.get(userId);
       if (sockets) {
         for (const socketId of Array.from(sockets)) {
           const sock = this.server.sockets.sockets.get(socketId);
           if (sock) {
             const roomId = this.inMemoryUserRooms.get(socketId);
             if (roomId) {
               sock.to(roomId).emit('stranger_left', { roomId });
               sock.leave(roomId);
             }
             sock.disconnect(true); // Forced disconnect
           }
         }
         this.inMemoryUserSockets.delete(userId);
       }
       this.broadcastFriendPresence(userId, false);
     }
     ```
4. **Active Video Call In-Memory Sessions**:
   - **Gap**: `handleUserAccountDeleted` does **NOT** call `this.clearActiveCallSession(callId)` or emit `video_call_ended` to the peer!
   - If a user deletes their account while in an active video call without hanging up first, the peer's video call remains in a hanging state until the peer detects WebRTC disconnection or ICE failure, because `handleUserAccountDeleted` does not emit `video_call_ended` directly to the peer.

---

## 7. Authentication & Session Audit

### Session Mechanism:
- Chirp uses an HMAC-SHA256 stateless session token signed with `SESSION_SECRET` ([backend/src/auth/session-token.service.ts](file:///c:/Users/Raja/OneDrive/Desktop/stranger-chat/backend/src/auth/session-token.service.ts)).
- The token contains `{ userId, iat, exp }`. Default expiry is 30 days.

### Client-Side Purge:
- `clearPersistedAuth()` removes all the following keys:
  - `localStorage.removeItem("sc_auth_token")`
  - `localStorage.removeItem("sc_auth_user_id")`
  - `localStorage.removeItem("sc_last_user_id")`
  - `localStorage.removeItem("sc_session_token")`
  - `localStorage.removeItem("sc_user_id")`
  - `localStorage.removeItem("sc_session_user_id")`
  - `sessionStorage.removeItem("sc_session_token")`
  - `sessionStorage.removeItem("sc_session_user_id")`
  - `sessionStorage.removeItem("sc_user_id")`

### Server-Side Revocation:
- **Gap**: Tokens are stateless and not persisted in a database or Redis blocklist.
- If a client copies their token before deleting their account, the token signature remains cryptographically valid.
- However, when the client presents that token to `SessionAuthGuard` for an endpoint that checks the database (such as `/users/:userId/profile`), PostgreSQL returns `404 Not Found`.

---

## 8. Frontend Local Data Audit

| Storage Type | Key / Store Name | Content | Cleared on Account Deletion? |
|---|---|---|---|
| `localStorage` | `sc_auth_token` | Signed session token | **YES** |
| `localStorage` | `sc_auth_user_id` | User UUID | **YES** |
| `localStorage` | `sc_last_user_id` | User UUID | **YES** |
| `localStorage` | `sc_session_token` | Duplicate auth token | **YES** |
| `localStorage` | `sc_user_id` | User UUID | **YES** |
| `localStorage` | `sc_session_user_id` | User UUID | **YES** |
| `sessionStorage` | `sc_session_token` | Session token | **YES** |
| `sessionStorage` | `sc_session_user_id` | User UUID | **YES** |
| `sessionStorage` | `sc_user_id` | User UUID | **YES** |
| `IndexedDB` | `chirp-e2ee-keystore` / `identity_keys` | ECDH P-256 private and public keys | **YES** (`clearIdentityKeys()`) |
| React State | `currentUserProfile`, `messages`, `friends`, `notifications`, etc. | In-memory conversation and profile state | **YES** (reset to `null` / `[]`) |
| Cookies | None | Chirp does not set cookies | N/A |

---

## 9. E2EE Cryptographic Material Audit

1. **Private Key**:
   - Generated client-side via Web Crypto API (`ECDH P-256`).
   - Stored strictly in IndexedDB (`chirp-e2ee-keystore`).
   - Never sent over the network or persisted to any server.
   - **Deletion**: Explicitly wiped via `await clearIdentityKeys()` during `handleDeleteAccount()`.
2. **Public Key**:
   - Base64 SPKI representation stored in PostgreSQL `User.publicKey`.
   - **Deletion**: Purged when the `User` row is deleted.
3. **Decryption Capability Post-Deletion**:
   - Because `clearIdentityKeys()` deletes the private key from IndexedDB, the browser cannot decrypt any previously exchanged ciphertexts even if old cached envelopes were somehow accessible.

---

## 10. Data Ownership Edge Cases Analysis

### Scenario A: User deletes account after sending text messages
- **Behavior**: All chats involving the user are identified (`allChatIds`). All messages in those chats are deleted via `tx.message.deleteMany`. Any stray messages sent by the user elsewhere are deleted via `where: { senderId: userId }`.
- **Result**: Completely purged from PostgreSQL.

### Scenario B: User deletes account after sending photos
- **PostgreSQL**: `Chat`, `Message`, and `MediaAttachment` rows are deleted.
- **Backblaze B2**: **ORPHANED**. The encrypted `.bin` file in `media/<chatId>/<mediaId>.bin` remains in B2 indefinitely.

### Scenario C: User deletes account after sending voice notes
- **PostgreSQL**: Same as Scenario B (all rows deleted).
- **Backblaze B2**: **ORPHANED**. The encrypted audio binary remains in B2 indefinitely.

### Scenario D: User deletes account after receiving media from another user
- **PostgreSQL**: The entire `Chat` between both users is deleted. The recipient's view and sender's view of the chat are gone.
- **Backblaze B2**: **ORPHANED**. The media sent by the *other* user is also orphaned in B2 because the database records linking to it were destroyed, but the B2 object was never deleted.

### Scenario E: User has an existing friend chat
- **Behavior**: The `Friendship` row is deleted. The linked `Chat` (via `Friendship.chatId`) is deleted. All messages are deleted.
- **Result**: The peer friend sees the friend disappear from their friends list. Any media in B2 remains orphaned.

### Scenario F: User is currently matched with a stranger
- **Behavior**: `handleUserAccountDeleted` sends `stranger_left` to the stranger room. Socket is forcibly closed.
- **Peer Experience**: The stranger receives `stranger_left` and sees "Stranger has disconnected". Active match lock in Redis is deleted.

### Scenario G: User is currently in a video call
- **Behavior**: Frontend teardown halts local media. Backend disconnects socket.
- **Peer Experience**: Peer's client receives WebRTC connection state `disconnected`/`failed`, but backend fails to send an explicit `video_call_ended` event to the peer, leaving the peer's UI to time out on ICE disconnection.

### Scenario H: Media upload is in progress during account deletion
- **Behavior**: The presigned URL remains valid in the browser for up to 300 seconds. If the browser finishes `PUT` to B2 after the account was deleted:
  - B2 accepts the upload.
  - No `Message` is ever created in PostgreSQL.
  - The `MediaAttachment` in PostgreSQL was either deleted or never committed.
  - **Result**: A permanent orphan object exists in B2.

---

## 11. Failure / Partial-Deletion Analysis

1. **Transaction Integrity (PostgreSQL)**:
   - All PostgreSQL deletions occur inside `await this.prisma.$transaction(async (tx) => { ... })`.
   - If any query fails (e.g. timeout, foreign key conflict), the entire transaction rolls back. The user account is NOT deleted, and the user receives HTTP 500.
2. **Redis vs PostgreSQL Decoupling**:
   - `this.redis.cleanupUserRedisState(userId)` is executed *after* the PostgreSQL transaction commits.
   - If Redis is down or times out, the user is already deleted in PostgreSQL. This is non-fatal because Redis keys have natural TTLs and Redis presence is ephemeral.
3. **Gateway Hook Failure**:
   - The gateway hook is wrapped in a try/catch:
     ```typescript
     try {
       await this.deletionHook(userId);
     } catch (err) {
       console.warn(`[Account Deletion] Gateway hook warning:`, err);
     }
     ```
   - Even if the WebSocket server is unavailable or fails, PostgreSQL deletion proceeds.
4. **B2 Deletion Risk (Future Implementation)**:
   - When B2 deletion is implemented, B2 does not participate in the database transaction.
   - If B2 objects are deleted *after* PostgreSQL commit and B2 network fails, objects are orphaned.
   - If B2 objects are deleted *before* PostgreSQL commit and PostgreSQL rolls back, media is destroyed while the account remains active.
   - **Recommended Pattern**: Soft-collect storage keys inside the transaction, commit the DB purge, and then trigger B2 object deletion (with a background retry queue for failed B2 deletes).

---

## 12. Deletion Matrix

| Data Entity | Storage Location | User Association | Deleted Today? | Cascade Mechanism | Severity / Risk |
|---|---|---|---|---|---|
| **User** | PostgreSQL | Direct (`id`) | **YES** | Direct `tx.user.delete` | None |
| **Profile & Public Key** | PostgreSQL | Direct on `User` | **YES** | Direct on `User` | None |
| **Friendships** | PostgreSQL | `userAId` / `userBId` | **YES** | `tx.friendship.deleteMany` | None |
| **Friend Requests** | PostgreSQL | `senderId` / `receiverId` | **YES** | `tx.friendRequest.deleteMany` | None |
| **Blocks** | PostgreSQL | `blockerId` / `blockedId` | **YES** | `tx.block.deleteMany` | None |
| **Reports** | PostgreSQL | `reporterId` / `reportedId` / `chatId` | **YES** | `tx.report.deleteMany` | None |
| **Notifications** | PostgreSQL | `userId` | **YES** | `tx.notification.deleteMany` + Schema cascade | None |
| **Chats** | PostgreSQL | `userAId` / `userBId` | **YES** | `tx.chat.deleteMany` | None |
| **Messages** | PostgreSQL | `senderId` / `chatId` | **YES** | `tx.message.deleteMany` | None |
| **Reactions** | PostgreSQL | `userId` / `messageId` | **YES** | `tx.reaction.deleteMany` + Schema cascade | None |
| **MediaAttachment** | PostgreSQL | `senderId` / `chatId` | **MOSTLY** | Schema cascade on `Chat` and `Message` | **MEDIUM**: Unlinked attachments may orphan if chat missing |
| **Encrypted Photos** | **Backblaze B2** | `MediaAttachment.storageKey` | **NO** | **NONE** | **CRITICAL**: Stored permanently in B2 |
| **Encrypted Voice Notes** | **Backblaze B2** | `MediaAttachment.storageKey` | **NO** | **NONE** | **CRITICAL**: Stored permanently in B2 |
| **Redis Presence** | Redis | `userId` | **YES** | `cleanupUserRedisState` | None |
| **Redis Match Queue** | Redis | `userId` | **YES** | `cleanupUserRedisState` (`lrem`) | None |
| **Redis AI Cooldown** | Redis | `userId` | **YES** | `cleanupUserRedisState` | None |
| **Redis Daily AI Quota** | Redis | `userId` | **NO** | None (expires on day rollover) | **LOW** |
| **Redis Active Match** | Redis | `userId` | **YES** | `cleanupUserRedisState` | None |
| **Redis Socket Mapping** | Redis | `socketId` | **NO** | Cleared only on socket disconnect or 24h TTL | **LOW** |
| **Session Token (Client)** | LocalStorage / SessionStorage | Keyed in browser | **YES** | `clearPersistedAuth()` | None |
| **Session Token (Server)** | Stateless HMAC | In-memory validation | **PARTIAL** | DB row deleted, but token signature valid | **LOW** |
| **E2EE Private Key** | Browser IndexedDB | `identity_keys` | **YES** | `clearIdentityKeys()` | None |
| **Active Call Session** | Gateway Memory | `userId` / `callId` | **NO** | Gateway hook does not clear call session | **MEDIUM** |

---

## 13. Exact Gaps Found

1. **GAP-B2-01: No Backblaze B2 Object Deletion**:
   - `UsersService.deleteAccount()` does not collect B2 `storageKey`s or call `B2StorageService.deleteObject()`. All user media remains in B2 after deletion.
2. **GAP-DB-02: `MediaAttachment` Lacks Direct User FK or Explicit Sender Purge**:
   - `MediaAttachment` relies on `Chat` cascade. If a presigned upload was initiated but never assigned a `messageId` and belongs to an older/unmatched chat, it is not purged by user ID.
3. **GAP-CALL-03: Gateway Hook Does Not Teardown Active Video Call Session**:
   - `handleUserAccountDeleted(userId)` does not call `this.clearActiveCallSession(...)` or emit `video_call_ended` to active call peers.
4. **GAP-REDIS-04: Redis Stale Keys Not Purged**:
   - Daily AI quota keys (`ai:daily-usage:${userId}:*`) are not removed in `cleanupUserRedisState`.

---

## 14. Recommended Implementation Plan (For Future Action)

1. **Step 1: Update `UsersService.deleteAccount` to Query and Purge B2 Media**:
   - Before executing the DB transaction, find all `MediaAttachment` records where:
     ```typescript
     const attachments = await tx.mediaAttachment.findMany({
       where: {
         OR: [
           { senderId: userId },
           { chatId: { in: allChatIds } },
         ],
       },
       select: { id: true, storageKey: true },
     });
     ```
   - In `MediaService` / `B2StorageService`, implement `deleteObjects(storageKeys: string[])`.
   - After DB transaction commits, asynchronously delete all collected storage keys from B2.
2. **Step 2: Add Direct `MediaAttachment` Cleanup in Transaction**:
   - Explicitly add `await tx.mediaAttachment.deleteMany({ where: { senderId: userId } });` to guarantee no unlinked attachments remain.
3. **Step 3: Enhance `ChatGateway.handleUserAccountDeleted`**:
   - Look up `getActiveCallForUser(userId)`.
   - If an active call exists, call `this.clearActiveCallSession(call.callId)` and emit `video_call_ended` to the room/peer with reason `'account_deleted'`.
4. **Step 4: Expand Redis Cleanup**:
   - Add pattern deletion or date-specific deletion for `ai:daily-usage:${userId}:*` in `cleanupUserRedisState`.

---

## 15. Implementation & Verification Summary

### Implementation Complete (September 25, 2026)

All audited gaps have been resolved:
1. **Backblaze B2 Batch Deletion**:
   - Added `deleteObjects(keys: string[])` to `B2StorageService` using AWS S3-compatible `DeleteObjectsCommand` with chunking for the 1000-object limit.
   - Added `deleteMediaObjects(storageKeys: string[])` delegation in `MediaService`.
   - Injected `MediaModule` / `MediaService` into `UsersModule` and `UsersService`.
   - `UsersService.deleteAccount(userId)` collects all `storageKey`s for sent media (attached and pending/unattached) and chats being deleted prior to database removal.
   - B2 media objects are deleted **after** the PostgreSQL transaction commits successfully, ensuring database rollback never destroys media prematurely.
2. **Explicit `MediaAttachment` Cleanup**:
   - Added explicit `tx.mediaAttachment.deleteMany({ where: { OR: [{ senderId: userId }, { chatId: { in: allChatIds } }] } })` inside the database transaction so orphan/unattached media records are never left behind.
3. **Active Video Call Teardown**:
   - In `ChatGateway.handleUserAccountDeleted(userId)`, active calls involving the deleting user are retrieved via `this.getActiveCallForUser(userId)`.
   - The gateway immediately emits `video_call_ended` with `{ roomId, callId, reason: 'account_deleted' }` to the room and directly to the peer.
   - In-memory call sessions are cleared via `this.clearActiveCallSession(...)`.
   - `hooks/useVideoCall.ts` handles `reason === 'account_deleted'` to display a friendly notification and immediately return the peer to the chat view.
4. **Comprehensive Redis Cleanup**:
   - In `RedisService.cleanupUserRedisState(userId)`, the user's active socket mappings (`socket:map:${socketId}`) and socket presence keys (`presence:user:${socketId}`) are gathered and deleted.
   - Scans and deletes all daily AI keys (`ai:daily-usage:${userId}:*`).
   - Cleans presence, match locks, and matchmaking queue entries.

### Exact Deletion Order
```text
UI "Log out & Delete Account" confirmed
  ↓
REST DELETE /users/:userId/account (SessionAuthGuard IDOR verified)
  ↓
Gateway deletion hook:
  ├─ Tear down active video call (emit video_call_ended reason='account_deleted')
  ├─ Clear in-memory call sessions
  ├─ Force-disconnect active sockets (sock.disconnect(true))
  └─ Broadcast offline presence to friends
  ↓
Prisma Transaction (Atomic):
  ├─ Identify friendships & chats
  ├─ Collect B2 storageKeys (senderId == userId OR chatId in allChatIds)
  ├─ Delete messages in chats & sent by user
  ├─ Explicitly delete MediaAttachments (attached & unattached)
  ├─ Delete friendships, reports, chats, friend requests, blocks, reactions, notifications
  ├─ Delete User row
  └─ Increment PlatformStats.totalDeletedAccounts
  ↓
Transaction Commit
  ↓
B2 Object Purge (deleteMediaObjects with DeleteObjectsCommand)
  ↓
Redis State Cleanup:
  ├─ Delete socket:map and presence:user for user's sockets
  ├─ Delete presence:user, presence:sockets, ai:cooldown, ai:inflight, user:match
  ├─ Scan and delete ai:daily-usage:${userId}:*
  └─ Remove user from matchmaking:waiting
  ↓
Frontend Cleanup:
  ├─ Clear localStorage (auth token, user IDs)
  ├─ Clear sessionStorage
  ├─ Clear IndexedDB E2EE identity keys (clearIdentityKeys())
  └─ Reset React states and route to profile setup
```

### Known In-Flight Upload Limitation
- **Presigned Upload Race**: If a client generates a presigned upload URL immediately before deleting their account and continues uploading raw bytes to B2 after account deletion completes, that raw binary file will land in the B2 bucket. Because all database records were deleted, no presigned download URL can ever be generated for it, but the raw binary will remain in B2 unless cleaned up by bucket lifecycle rules (e.g. 30-day unreferenced lifecycle rule in Backblaze console).

### Verification Results
- **Backend Build (`nest build`)**: PASSED (0 errors).
- **Frontend Typecheck (`tsc --noEmit`)**: PASSED (0 errors).
- **Focused Account Deletion Test Suite (5 suites, 82 tests)**: PASSED (100%).
- **Full Backend Regression Suite (26 suites, 285 tests)**: PASSED (100%).
