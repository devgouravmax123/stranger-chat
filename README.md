# Chirp

<p align="center">
  <strong>Real-time anonymous & friend communication platform featuring End-to-End Encryption (E2EE), WebRTC voice/video calls, Backblaze B2 encrypted media storage, and Gemini-powered conversation intelligence.</strong>
</p>

<p align="center">
  <a href="https://stranger-chat-gamma-five.vercel.app"><img src="https://img.shields.io/badge/Live_Demo-Production-6366f1?style=for-the-badge&logo=vercel&logoColor=white" alt="Live Demo" /></a>
  <img src="https://img.shields.io/badge/Next.js-16.3.4-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19.2.8-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/NestJS-12-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-7.10-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [End-to-End Encryption (E2EE) & Security](#end-to-end-encryption-e2ee--security)
- [Core Engineering Flows](#core-engineering-flows)
  - [1. Anonymous Matchmaking Flow](#1-anonymous-matchmaking-flow)
  - [2. Authenticated Session Lifecycle](#2-authenticated-session-lifecycle)
  - [3. Encrypted Media & Voice Note Pipeline](#3-encrypted-media--voice-note-pipeline)
  - [4. WebRTC Video & Audio Calling](#4-webrtc-video--audio-calling)
  - [5. Gemini AI Conversation Assistance](#5-gemini-ai-conversation-assistance)
- [Technology Stack](#technology-stack)
- [Project Directory Structure](#project-directory-structure)
- [Data Model](#data-model)
- [API & Real-Time Protocol](#api--real-time-protocol)
  - [HTTP REST Endpoints](#http-rest-endpoints)
  - [WebSocket / Socket.IO Protocol](#websocket--socketio-protocol)
- [Local Development & Setup](#local-development--setup)
  - [Prerequisites](#prerequisites)
  - [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
  - [Option B: Native Local Development](#option-b-native-local-development)
- [Environment Variables](#environment-variables)
- [Production Deployment](#production-deployment)
- [Testing & Quality Assurance](#testing--quality-assurance)

---

## Overview

**Chirp** is a production-grade, real-time messaging and social discovery system engineered for high-concurrency real-time interactions, client-side encrypted media storage, and browser-native cryptography.

The application combines:
- **Instant Stranger Discovery:** Redis-backed preference queues pairing participants based on language, shared interests, and conversation goals.
- **Persistent Friendships & Private Chat:** Transition from ephemeral stranger chats into persistent friendships with full chat history, message reactions, message deletion, and rich read receipts.
- **Client-Side Cryptography (E2EE):** Direct browser-to-browser encryption for text, images, and voice recordings using native Web Crypto API primitives (ECDH P-256 key exchange + HKDF-SHA-256 key derivation + AES-256-GCM symmetric encryption with Authenticated Additional Data).
- **Client-Encrypted Cloud Media Storage:** Media binaries are encrypted in the browser before transmission, uploaded directly to Backblaze B2 object storage via presigned S3-compatible URLs, and decrypted exclusively on recipient clients.
- **P2P Audio/Video Communication:** WebRTC peer connections negotiated via NestJS WebSocket signaling with interactive in-call control.
- **Context-Aware AI Suggestions:** Google Gemini integration providing real-time, multilingual conversation starters and contextual reply suggestions with strict rate limiting.

---

## Key Features

### ⚡ Real-Time Messaging & Stranger Matching
* **Redis-Backed Matchmaking:** Preference-based matching queues using Redis FIFO sets for languages, canonical interests, and goals.
* **Session Resiliency:** In-memory and Redis-backed session restoration across page reloads and transient network reconnects.
* **Rich Messaging Suite:** Real-time typing indicators, delivery timestamps, seen receipts, emoji reactions, message deletion, and threaded replies.

### 🔒 Cryptography & Privacy (E2EE)
* **Client-Side Key Generation:** Private keys are generated as non-extractable `CryptoKey` objects stored in the browser's IndexedDB.
* **AES-256-GCM Payload Protection:** Unique cryptographically random 12-byte initialization vectors (IVs) generated per message.
* **Contextual AAD Binding:** Text and media payloads are bound to conversation metadata (Chat ID, Sender ID, Media Type, MIME) to ensure message integrity.

### 🎙️ Encrypted Media & Voice Notes
* **In-Browser Audio Recording:** Audio visualizer, Opus/WebM capture, and client-side binary compression.
* **Direct-to-B2 Uploads:** Backend produces short-lived presigned S3 URLs; raw encrypted bytes stream directly from client to Backblaze B2 without routing large binaries through API servers.

### 📹 WebRTC Audio & Video Calling
* **P2P Media Streaming:** Full-duplex audio and video streams negotiated via WebSocket signaling.
* **In-Call Controls:** Real-time microphone mute, camera toggle, and incoming call notification drawers.

### 🤖 Gemini AI Conversation Engine
* **Multilingual Context Detection:** Identifies conversational language (English, Hindi, Hinglish, regional dialects) and generates 3 natural, non-repetitive discussion prompts.
* **Strict Cost & Rate Controls:** Token-bucket rate limiting, cooldown timers, daily per-user quotas, and model fallback handling (`gemini-3.1-flash-lite` $\rightarrow$ `gemini-3.6-flash`).

### 👥 Social Graph & Community Safety
* **User Profiles & Discovery:** Customizable avatars, bios, age/gender filters, and member search discovery.
* **Safety & Moderation:** User reporting workflows, two-way user blocking, and transactional account deletion with automatic B2 asset purging.

---

## System Architecture

```mermaid
graph TD
    subgraph Client ["Client Tier (Browser)"]
        UI[Next.js App Router UI]
        Crypto[WebCrypto Core - ECDH / AES-256-GCM]
        IDB[(IndexedDB Keystore)]
        RTC[WebRTC PeerConnection]
        Crypto --> IDB
    end

    subgraph CDN ["Edge & CDN"]
        Vercel[Vercel Edge Network]
    end

    subgraph BackendTier ["Application Tier (Render / Container)"]
        Nest[NestJS 12 Gateway & REST API]
        Auth[HMAC Session Service]
        Matching[Matching Service]
        MediaService[B2 Storage Service]
        AIService[Gemini Integration Service]
    end

    subgraph StorageTier ["Data & Infrastructure Tier"]
        Postgres[(Neon PostgreSQL)]
        Redis[(Upstash Redis Cache)]
        B2[(Backblaze B2 Object Storage)]
        GeminiAPI[Google Gemini AI API]
    end

    UI -->|HTTPS / Next.js SSR| Vercel
    UI -->|WSS / Socket.IO| Nest
    UI -->|HTTPS REST| Nest
    UI -->|Direct Encrypted Upload/Download| B2
    RTC <-->|P2P Media Stream| RTC

    Nest --> Auth
    Nest --> Matching
    Nest --> MediaService
    Nest --> AIService

    Matching --> Redis
    Nest --> Postgres
    MediaService -->|Presigned URLs S3 API| B2
    AIService -->|Generate Content| GeminiAPI
```

---

## End-to-End Encryption (E2EE) & Security

Chirp employs standard cryptographic primitives via the native **W3C Web Crypto API (`window.crypto.subtle`)**:

```mermaid
sequenceDiagram
    autonumber
    participant Alice as Alice (Client A)
    participant Server as NestJS / DB
    participant Bob as Bob (Client B)

    Note over Alice,Bob: 1. Identity Key Generation (IndexedDB)
    Alice->>Alice: Generate ECDH P-256 Keypair (non-extractable private key)
    Alice->>Server: Register Public Key (Base64 SPKI)
    Bob->>Bob: Generate ECDH P-256 Keypair (non-extractable private key)
    Bob->>Server: Register Public Key (Base64 SPKI)

    Note over Alice,Bob: 2. Matchmaking & Key Exchange
    Server-->>Alice: Matched with Bob (Includes Bob's Public Key)
    Server-->>Bob: Matched with Alice (Includes Alice's Public Key)

    Note over Alice,Bob: 3. Key Derivation (HKDF-SHA-256)
    Alice->>Alice: ECDH(Alice Private, Bob Public) -> 256-bit Shared Bits
    Alice->>Alice: HKDF-SHA-256(Shared Bits, info="chirp:e2ee:v1:conversation:<chatId>") -> AES Key
    Bob->>Bob: ECDH(Bob Private, Alice Public) -> 256-bit Shared Bits
    Bob->>Bob: HKDF-SHA-256(Shared Bits, info="chirp:e2ee:v1:conversation:<chatId>") -> AES Key

    Note over Alice,Bob: 4. Message Transmission
    Alice->>Alice: AES-256-GCM Encrypt(Plaintext, 12-byte IV, AAD)
    Alice->>Server: send_message({ ciphertext, iv })
    Server->>Server: Persist Ciphertext in PostgreSQL
    Server->>Bob: receive_message({ ciphertext, iv })
    Bob->>Bob: AES-256-GCM Decrypt(Ciphertext, IV, AAD) -> Plaintext
```

### Cryptographic Construction
| Parameter | Exact Implementation | Purpose |
| :--- | :--- | :--- |
| **Key Exchange** | ECDH over NIST Curve P-256 (`secp256r1`) | Derives shared cryptographic secret between participants |
| **Key Derivation** | HKDF with SHA-256 (`salt = 32-byte zero`, `info = "chirp:e2ee:v1:conversation:<chatId>"`) | Derives a unique 256-bit AES-GCM symmetric key per conversation |
| **Symmetric Cipher** | AES-256-GCM (`128-bit authentication tag`) | Authenticated symmetric encryption for text and media payloads |
| **IV Generation** | `crypto.getRandomValues(new Uint8Array(12))` | Cryptographically random 12-byte Initialization Vector per message |
| **Text AAD** | `"chirp:e2ee:v1:message:<chatId>:<senderId>"` | Authenticates that text ciphertext belongs to the specific conversation and sender |
| **Media AAD** | `"chirp:e2ee:v1:media:<chatId>:<senderId>:<type>:<mime>"` | Authenticates media binary with chat, sender, media type, and MIME binding |
| **Key Storage** | IndexedDB (`chirp_e2ee_keystore`, `extractable: false`) | Protects private keys from programmatic export via raw memory dumps |

### Threat Model & Boundaries
- **Plaintext Confidentiality:** Text message contents, images, and audio notes are encrypted client-side. The backend database and object storage store only ciphertext bytes.
- **Server Metadata Visibility:** The backend application and database observe conversation metadata (Chat ID, Sender ID, timestamps, message delivery/seen statuses, media MIME types, file sizes, and storage keys) to facilitate routing and persistence.
- **Client Storage:** Non-extractable `CryptoKey` objects in IndexedDB prevent programmatic extraction of raw private key bytes via `exportKey`.

---

## Core Engineering Flows

### 1. Anonymous Matchmaking Flow
1. **Initiation:** Client emits `find_stranger` with preference filters (Language, Interests, Goal).
2. **Queueing:** `MatchingService` places user in Redis FIFO preference queues (`matchmaking:waiting:<lang>:<goal>`).
3. **Pairing:** When a compatible stranger is found, a new `Chat` record is generated in PostgreSQL, and both sockets are joined to an isolated room `room:<chatId>`.
4. **Exchange:** Public keys of both users are transmitted in the `matched` socket event, prompting instantaneous client-side HKDF shared secret derivation.

### 2. Authenticated Session Lifecycle
1. **Guest Issuance:** Upon initial handshake, an anonymous UUID and a cryptographically signed HMAC-SHA256 session token are issued to the client.
2. **Storage:** Stored locally in `localStorage` and `sessionStorage`.
3. **Session Reconnection:** When the user returns, `bootstrapSession()` validates the token against `/users/me`.
4. **Resiliency & Auto-Recovery:** If the session is invalid (`401`/`404`), stored tokens are cleared and the client seamlessly initializes a fresh guest identity without stalling the UI.

### 3. Encrypted Media & Voice Note Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant Client as Sender (Browser)
    participant API as NestJS API
    participant B2 as Backblaze B2 (S3)
    participant Recipient as Receiver (Browser)

    Client->>Client: Compress Image / Record Audio (WebM/Opus)
    Client->>Client: Encrypt binary with AES-256-GCM + Media AAD
    Client->>API: POST /media/presigned-upload (fileSize, mime, iv)
    API->>API: Verify session & generate S3 PutObject URL
    API-->>Client: Return { uploadUrl, mediaId, storageKey }
    Client->>B2: HTTP PUT raw encrypted bytes directly to B2
    Client->>API: Socket.emit('send_image_message' / 'send_voice_message', { mediaId, iv, ... })
    API->>Recipient: Socket.emit('receive_message', { mediaId, iv, ... })
    Recipient->>API: GET /media/presigned-download/:mediaId
    API-->>Recipient: Return { downloadUrl }
    Recipient->>B2: HTTP GET encrypted binary from B2
    Recipient->>Recipient: Decrypt bytes with AES-256-GCM -> Display/Play
```

### 4. WebRTC Video & Audio Calling
- **Signaling:** Handled via Socket.IO events (`video_call_request`, `video_call_accepted`, `video_offer`, `video_answer`, `video_ice_candidate`).
- **Media Path:** Direct peer-to-peer connection utilizing Google STUN servers (`stun:stun.l.google.com:19302`). Audio and video streams bypass backend servers completely.

### 5. Gemini AI Conversation Assistance
- **Trigger:** On demand or after conversation lulls, client calls `POST /ai/conversation-suggestions`.
- **Sanitization:** Backend pulls the last up to 15 text messages (truncated to 300 characters each), strips private metadata, and supplies a context prompt to the Google Gemini model.
- **Safety & Cooldown:** Server limits requests to 1 call per 10 seconds per user and 5 calls per match session, with a fallback from `gemini-3.1-flash-lite` to `gemini-3.6-flash` upon transient provider errors.

---

## Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | Next.js (App Router, Turbopack) | `16.3.4` | Server-rendered React application |
| **Frontend Runtime** | React | `19.2.8` | Component architecture and state management |
| **Styling & UI** | Tailwind CSS / PostCSS | `v4` | Responsive dark-mode styling & layout |
| **Realtime Client** | Socket.IO Client | `4.8.3` | Low-latency bi-directional WebSocket client |
| **Backend Framework** | NestJS | `12.0.1` | Modular Node.js enterprise backend |
| **Language** | TypeScript | `5.0+` | End-to-end type safety |
| **Database & ORM** | PostgreSQL + Prisma ORM | `7.10.0` | Relational data persistence and migrations |
| **Cache & Realtime State**| Redis (ioredis) | `6.0.0` | Matchmaking queues, active socket state, presence |
| **Object Storage** | Backblaze B2 (AWS S3 SDK) | `3.1139.0` | S3-compatible encrypted media object storage |
| **AI Integration** | Google GenAI SDK (`@google/genai`) | `2.22.0` | Gemini conversation suggestion engine |
| **Containerization** | Docker & Docker Compose | Multi-stage | Isolated container builds & local orchestration |
| **Hosting (Production)** | Vercel (Frontend) + Render (Backend) | - | Production cloud deployment |

---

## Project Directory Structure

```text
chirp/
├── app/                          # Next.js App Router frontend
│   ├── diagnostic/               # Media & hardware diagnostic utility
│   ├── globals.css               # Global theme tokens and animations
│   ├── layout.tsx                # Root layout, metadata, favicon configuration
│   └── page.tsx                  # Main single-page application & state router
├── components/                   # Focused React components
│   ├── AiSuggestions.tsx         # AI suggestion floating pills & trigger
│   ├── AppHeader.tsx             # Navigation bar, profile badge, notifications
│   ├── AppSidebar.tsx            # Friends list, requests, search & presence
│   ├── AudioPlayer.tsx           # Waveform-based encrypted audio player
│   ├── CallingModal.tsx          # Outgoing WebRTC call modal
│   ├── ChatHeader.tsx            # Chat partner info, status, call actions
│   ├── DiscoverPeopleView.tsx    # Member search & discovery view
│   ├── EditProfileModal.tsx      # User profile edit modal
│   ├── ImageLightboxModal.tsx    # Fullscreen encrypted photo preview
│   ├── IncomingCallModal.tsx     # Incoming WebRTC call invitation prompt
│   ├── MessageInput.tsx          # E2EE input box, attachments, emoji picker
│   ├── MessageList.tsx           # Virtualized message stream, reactions, replies
│   ├── NotificationDropdown.tsx  # In-app notifications menu
│   ├── ProfileSetup.tsx          # Initial visitor profile setup screen
│   ├── ReportModal.tsx           # User safety and reporting modal
│   ├── SearchFriendsView.tsx     # Friend discovery & query panel
│   ├── UserProfileModal.tsx      # Member details and public bio viewer
│   ├── VideoCallOverlay.tsx      # Fullscreen WebRTC video grid overlay
│   └── VoiceRecorder.tsx         # Voice note audio recorder & visualizer
├── hooks/
│   └── useVideoCall.ts           # WebRTC lifecycle & peer connection hook
├── lib/
│   ├── api-config.ts             # Centralized API base URL resolver
│   ├── audioConverter.ts         # Audio encoding & Opus/WAV utilities
│   ├── crypto.ts                 # WebCrypto E2EE core (ECDH, HKDF, AES-GCM)
│   ├── imageCompressor.ts        # Client-side image downscaling
│   ├── interests.ts              # Canonical interest definitions
│   └── mediaUploader.ts          # Encrypted B2 upload & download pipeline
├── backend/
│   ├── prisma/
│   │   └── schema.prisma         # Database schema & entity relations
│   ├── src/
│   │   ├── auth/                 # HMAC session token signing & guards
│   │   ├── chat/                 # Socket.IO Gateway & Matchmaking logic
│   │   ├── common/               # CORS config, rate limiters, middleware
│   │   ├── friends/              # Friend request & friendship REST API
│   │   ├── gemini/               # Google Gemini suggestion service
│   │   ├── media/                # Presigned upload/download & B2 client
│   │   ├── notifications/        # In-app notification management
│   │   ├── prisma/               # Prisma database client module
│   │   ├── redis/                # Redis connection & matchmaking cache
│   │   ├── users/                # User profile & moderation endpoints
│   │   ├── app.module.ts         # NestJS root application module
│   │   └── main.ts               # NestJS bootstrap entry point
│   ├── Dockerfile                # Multi-stage production backend Dockerfile
│   └── package.json              # Backend dependencies and test scripts
├── public/                       # Static public assets (Favicon, Logo, SVGs)
├── Dockerfile                    # Multi-stage Next.js standalone Dockerfile
├── docker-compose.yml            # Containerized local development stack
├── next.config.ts                # Environment-aware Next.js configuration
└── README.md                     # Project documentation
```

---

## Data Model

```mermaid
erDiagram
    User ||--o{ Chat : "participates in"
    User ||--o{ Message : "sends"
    User ||--o{ Reaction : "reacts"
    User ||--o{ FriendRequest : "sends/receives"
    User ||--o{ Friendship : "friends with"
    User ||--o{ Notification : "receives"
    User ||--o{ Report : "files/receives"
    User ||--o{ Block : "blocks/blocked"

    Chat ||--o{ Message : "contains"
    Chat ||--o{ MediaAttachment : "stores"
    Chat ||--o| Friendship : "private channel"

    Message ||--o{ Reaction : "has"
    Message ||--o| MediaAttachment : "attaches"
    Message ||--o{ Message : "replies to"

    User {
        string id PK
        string username UK
        int age
        string gender
        string avatar
        string language
        string[] interests
        string goal
        string publicKey "Base64 SPKI ECDH Key"
        boolean isBanned
        datetime lastSeenAt
        datetime createdAt
    }

    Chat {
        string id PK
        string userAId FK
        string userBId FK
        datetime createdAt
        datetime endedAt
    }

    Message {
        string id PK
        string chatId FK
        string senderId FK
        string content "Encrypted ciphertext"
        string status "sent|delivered|seen"
        string replyToId FK
        datetime deliveredAt
        datetime seenAt
        datetime deletedAt
        datetime createdAt
    }

    MediaAttachment {
        string id PK
        string messageId FK
        string chatId FK
        string senderId
        string storageKey "B2 Object Key"
        string mediaType "image|voice"
        string mimeType
        int fileSize
        string iv "Base64 IV"
        datetime createdAt
    }
```

---

## API & Real-Time Protocol

### HTTP REST Endpoints

| Method | Route | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | No | System health, uptime, and database connectivity check |
| `GET` | `/stats` | No | Platform aggregate statistics (signups, active users) |
| `GET` | `/users/me` | Bearer Token | Authenticate and verify active session token |
| `GET` | `/users/:id/profile` | No | Fetch public profile for a user |
| `PUT` | `/users/:id/profile` | Bearer Token | Update profile attributes (username, avatar, bio) |
| `PUT` | `/users/:id/preferences`| Bearer Token | Update matchmaking filters and interests |
| `DELETE`| `/users/me` | Bearer Token | Permanently delete account and associated media |
| `GET` | `/friends/:userId` | No | List confirmed friends and online statuses |
| `GET` | `/friends/discover` | No | Discover users by interests/demographics |
| `POST`| `/friends/request` | Bearer Token | Send friend invitation |
| `PUT` | `/friends/request/:id/accept` | Bearer Token | Accept incoming friend invitation |
| `POST`| `/media/presigned-upload` | Bearer Token | Request Backblaze B2 S3 presigned PUT URL |
| `GET` | `/media/presigned-download/:id` | Bearer Token | Request Backblaze B2 S3 presigned GET URL |
| `POST`| `/ai/conversation-suggestions` | Bearer Token | Request Gemini conversation topic starters |
| `GET` | `/notifications/:userId` | No | Fetch persistent notification feed |

### WebSocket / Socket.IO Protocol

#### Client Emitters (`Client -> Server`)
- **Stranger Chat:**
  - `find_stranger` — Enter matchmaking queue with preferences `{ language, interests, goal }`.
  - `send_message` — Dispatch an encrypted stranger text message `{ roomId, chatId, content, replyToId }`.
  - `send_image_message` — Notify stranger room of uploaded encrypted image `{ roomId, chatId, mediaId, iv }`.
  - `send_voice_message` — Notify stranger room of uploaded encrypted voice note `{ roomId, chatId, mediaId, iv }`.
  - `skip_stranger` / `next_stranger` / `end_chat` — Leave current stranger room and cycle to matchmaking.
  - `typing` / `stop_typing` — Broadcast live typing status to current room.
  - `mark_seen` — Update message read receipt status.
  - `add_reaction` / `remove_reaction` — Add/remove emoji reactions on a message.
  - `delete_message` — Delete a previously sent message.
  - `report_stranger` / `block_stranger` — Report or block stranger.
- **Friend Chat:**
  - `open_friend_room` / `leave_friend_room` — Open or close dedicated 1-on-1 friend room.
  - `friend_online` — Broadcast online presence to confirmed friends.
  - `send_friend_message` — Dispatch an encrypted friend text message `{ roomId, chatId, content, replyToId }`.
  - `send_friend_image_message` — Notify friend room of uploaded encrypted image.
  - `send_friend_voice_message` — Notify friend room of uploaded encrypted voice note.
- **WebRTC Signaling:**
  - `video_call_request` / `video_call_accepted` / `video_call_declined` / `video_call_cancelled` / `video_call_ended`
  - `video_offer` / `video_answer` / `video_ice_candidate`

#### Server Listeners (`Server -> Client`)
- `user_ready` — Handshake acknowledgement returning verified user ID and signed session token.
- `auth_error` — Emitted when session token verification fails.
- `waiting` — Emitted when user is queued in matchmaking.
- `already_in_match` — Emitted if user attempts to queue while already in an active room.
- `matched` — Match pairing event containing room ID, chat ID, and stranger's public key.
- `receive_message` — Inbound encrypted message payload from peer.
- `chat_history` — Message history payload sent upon session restoration.
- `stranger_typing` — Peer typing state indicator.
- `stranger_left` — Notification that stranger disconnected or skipped the room.
- `stranger_online` — Notification that stranger reconnected to room.
- `message_seen` — Delivery/seen receipt update for dispatched messages.
- `reaction_updated` — Live emoji reaction update on a message.
- `message_deleted` — Message deletion broadcast.
- `friend_status_changed` — Real-time presence update (online/offline/last seen) for a friend.
- `new_notification` — In-app notification event.
- `incoming_video_call` / `video_call_accepted` / `video_call_declined` / `video_call_cancelled` / `video_call_ended`
- `video_offer` / `video_answer` / `video_ice_candidate`

---

## Local Development & Setup

### Prerequisites
- **Node.js:** `>= 20.9.0` (Node 20 or 22)
- **Package Manager:** `npm` (v10+)
- **Docker & Docker Compose:** Required for containerized local execution.
- **PostgreSQL Database:** Local instance or free [Neon](https://neon.tech) cloud database.
- **Redis Instance:** Local instance or [Upstash](https://upstash.com) Redis.
- **Backblaze B2 Account (Optional for local media testing):** S3-compatible Application Key & Bucket.
- **Google Gemini API Key (Optional for AI features):** [Google AI Studio](https://aistudio.google.com/).

---

### Option A: Docker Compose (Recommended)

To run the complete containerized stack locally:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/chirp.git
   cd chirp
   ```

2. **Configure environment:**
   ```bash
   cp .env.example backend/.env
   ```
   *Edit `backend/.env` with your `DATABASE_URL`, `GEMINI_API_KEY`, and `B2_*` credentials.*

3. **Launch all services via Docker Compose:**
   ```bash
   docker compose up -d --build
   ```

4. **Verify container status:**
   ```bash
   docker compose ps
   ```

5. **Access services:**
   - **Frontend Web App:** [http://localhost:3000](http://localhost:3000)
   - **Backend API & Health:** [http://localhost:3001/health](http://localhost:3001/health)
   - **Redis Cache:** `localhost:6379`

---

### Option B: Native Local Development

To run services directly on your host machine:

#### 1. Backend Setup
```bash
cd backend
npm install

# Generate Prisma Client
npx prisma generate

# Push database schema to your database
npx prisma db push

# Start NestJS development server
npm run start:dev
```
*Backend runs at `http://localhost:3001`.*

#### 2. Frontend Setup
```bash
# In a separate terminal at project root
npm install

# Start Next.js development server
npm run dev
```
*Frontend runs at `http://localhost:3000`.*

---

## Environment Variables

### Backend Configuration (`backend/.env`)
| Variable | Required | Default / Example | Description |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Yes** | `postgresql://user:password@host/neondb?sslmode=require` | PostgreSQL database connection string |
| `REDIS_URL` | **Yes** | `redis://localhost:6379` | Redis instance connection URL |
| `PORT` | No | `3001` | HTTP port for the NestJS server |
| `FRONTEND_URL` | No | `http://localhost:3000` | Allowed CORS origin for REST and WebSockets |
| `SESSION_SECRET` | No | `your-session-secret-key` | Secret key used to sign HMAC session tokens |
| `GEMINI_API_KEY` | Optional | `your-gemini-api-key` | Google Gemini API key for conversation suggestions |
| `GEMINI_MODEL` | No | `gemini-3.1-flash-lite` | Gemini model name |
| `AI_SUGGESTION_COOLDOWN_SECONDS` | No | `10` | Cooldown period between AI suggestion requests |
| `AI_SUGGESTION_DAILY_LIMIT` | No | `5` | Maximum AI suggestion requests allowed per user per day |
| `AI_GLOBAL_RPM_LIMIT` | No | `15` | Global RPM rate limit for AI calls |
| `AI_GLOBAL_RPD_LIMIT` | No | `500` | Global RPD limit for AI calls |
| `B2_ENDPOINT` | Optional | `https://s3.<region>.backblazeb2.com` | Backblaze B2 S3-compatible endpoint |
| `B2_REGION` | Optional | `<region>` | Backblaze B2 bucket region |
| `B2_ACCESS_KEY_ID` | Optional | `your-b2-access-key-id` | Backblaze B2 Application Key ID |
| `B2_SECRET_ACCESS_KEY` | Optional | `your-b2-secret-access-key` | Backblaze B2 Application Secret Key |
| `B2_BUCKET_NAME` | Optional | `your-b2-bucket-name` | Backblaze B2 target bucket name |

### Frontend Configuration (`.env.local` / Build Arguments)
| Variable | Scope | Default | Description |
| :--- | :---: | :--- | :--- |
| `NEXT_PUBLIC_BACKEND_URL` | Build-time | `http://localhost:3001` | Public backend URL reached by user browsers |
| `NEXT_PUBLIC_API_URL` | Build-time | `http://localhost:3001` | Fallback public backend URL |

---

## Production Deployment

Chirp is architected for decoupled cloud hosting:

```text
┌─────────────────────────┐          ┌─────────────────────────┐
│     Vercel (Frontend)   │          │     Render (Backend)    │
│  Next.js App Router SSR │          │  NestJS Node.js Web Svc │
└───────────┬─────────────┘          └────────────┬────────────┘
            │                                     │
            │          ┌──────────────────────────┼─────────────────────────┐
            │          │                          │                         │
            ▼          ▼                          ▼                         ▼
   ┌───────────────────────┐          ┌───────────────────────┐  ┌──────────────────────┐
   │    Neon PostgreSQL    │          │     Upstash Redis     │  │  Backblaze B2 Storage│
   │ Serverless DB Cluster │          │ Global In-Memory Cache│  │ Encrypted Media S3   │
   └───────────────────────┘          └───────────────────────┘  └──────────────────────┘
```

1. **Frontend on Vercel:**
   - Root directory: `./`
   - Build Command: `npm run build`
   - Set environment variable `NEXT_PUBLIC_BACKEND_URL` to your production Render backend URL.
   - Note: `next.config.ts` automatically detects `process.env.VERCEL` to use standard output for Vercel builds while maintaining standalone output for Docker images.
2. **Backend on Render:**
   - Root directory: `./backend`
   - Build Command: `npm install && npx prisma generate && npm run build`
   - Start Command: `npm run start:prod`
   - Add backend environment variables (`DATABASE_URL`, `REDIS_URL`, `B2_*`, `GEMINI_API_KEY`, `FRONTEND_URL`).

---

## Testing & Quality Assurance

### Run Frontend Build Validation
```bash
npm run build
```

### Run Backend Unit & Integration Tests
```bash
cd backend

# Execute all Vitest unit & integration suites
npm run test

# Run tests with code coverage report
npm run test:cov

# Run dedicated E2E integration test suite
npm run test:e2e
```

### Run Playwright Browser E2E Tests
```bash
# From project root
npx playwright test
```

---

## Contributing

1. Fork the repository.
2. Create a descriptive feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

<p align="center">
  Built with ❤️ for secure, private, and instantaneous global conversations.
</p>
