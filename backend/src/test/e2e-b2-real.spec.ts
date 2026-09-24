import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import { SessionTokenService } from '../auth/session-token.service.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { io, Socket } from 'socket.io-client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Real Browser & B2 E2E Verification', () => {
  let prisma: PrismaService;
  let sessionTokenService: SessionTokenService;
  let s3: S3Client;
  let socketA: Socket;
  let socketB: Socket;
  let userA: any;
  let userB: any;
  let tokenA: string;
  let tokenB: string;
  let chat: any;
  let roomId: string;
  let env: Record<string, string>;

  beforeAll(async () => {
    // Read backend .env
    const envContent = readFileSync(resolve('./.env'), 'utf-8');
    env = {};
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        let v = trimmed.slice(eqIdx + 1).trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        env[k] = v;
      }
    }

    prisma = new PrismaService();
    await prisma.$connect();

    s3 = new S3Client({
      endpoint: env.B2_ENDPOINT,
      region: env.B2_REGION,
      credentials: {
        accessKeyId: env.B2_ACCESS_KEY_ID,
        secretAccessKey: env.B2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });

    // Create 2 test users
    userA = await prisma.user.create({
      data: { username: `test_alice_${Date.now()}`, avatar: '👩', publicKey: 'alice-mock-pubkey' },
    });
    userB = await prisma.user.create({
      data: { username: `test_bob_${Date.now()}`, avatar: '👨', publicKey: 'bob-mock-pubkey' },
    });

    chat = await prisma.chat.create({
      data: { userAId: userA.id, userBId: userB.id },
    });
    await prisma.friendship.create({
      data: { userAId: userA.id, userBId: userB.id, chatId: chat.id },
    });
    roomId = `friend-${[userA.id, userB.id].sort().join('-')}`;

    sessionTokenService = new SessionTokenService();
    tokenA = sessionTokenService.signToken(userA.id);
    tokenB = sessionTokenService.signToken(userB.id);

    socketA = io('http://localhost:3001', { auth: { token: tokenA, userId: userA.id } });
    socketB = io('http://localhost:3001', { auth: { token: tokenB, userId: userB.id } });

    await Promise.all([
      new Promise((res) => socketA.once('user_ready', (d) => { tokenA = d.token; res(null); })),
      new Promise((res) => socketB.once('user_ready', (d) => { tokenB = d.token; res(null); })),
    ]);

    socketA.emit('open_friend_room', { userId: userA.id, friendId: userB.id });
    socketB.emit('open_friend_room', { userId: userB.id, friendId: userA.id });
    await new Promise((r) => setTimeout(r, 600));
  }, 30000);

  afterAll(async () => {
    socketA?.disconnect();
    socketB?.disconnect();
    if (userA && userB) {
      const userChats = await prisma.chat.findMany({
        where: {
          OR: [
            { userAId: userA.id }, { userBId: userA.id },
            { userAId: userB.id }, { userBId: userB.id },
          ],
        },
        select: { id: true },
      });
      const chatIds = userChats.map((c) => c.id);
      if (chatIds.length > 0) {
        await prisma.mediaAttachment.deleteMany({ where: { chatId: { in: chatIds } } });
        await prisma.message.deleteMany({ where: { chatId: { in: chatIds } } });
        await prisma.friendship.deleteMany({ where: { chatId: { in: chatIds } } });
        await prisma.chat.deleteMany({ where: { id: { in: chatIds } } });
      }
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    }
    await prisma.$disconnect();
  });

  it('1. Image Flow: Presigned upload -> Direct B2 PUT -> v2 envelope -> B2 download -> MediaAttachment linked', async () => {
    const rawImageBytes = Buffer.from('REAL_RAW_ENCRYPTED_IMAGE_BINARY_' + Date.now());
    const iv = 'MDEyMzQ1Njc4OWFi'; // 12-byte base64

    // A. Request presigned upload
    const presignRes = await fetch('http://localhost:3001/media/presigned-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        chatId: chat.id,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        fileSize: rawImageBytes.length,
        iv,
      }),
    });
    expect(presignRes.status).toBe(201);
    const { mediaId, storageKey, uploadUrl } = await presignRes.json();
    expect(mediaId).toBeDefined();
    expect(storageKey).toContain(`media/${chat.id}/${mediaId}.bin`);
    expect(uploadUrl).toContain(env.B2_BUCKET_NAME);

    // B. Direct HTTP PUT to Backblaze B2
    const b2PutRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: rawImageBytes,
    });
    expect(b2PutRes.status).toBe(200);

    // Verify object directly in B2
    const b2Obj = await s3.send(new GetObjectCommand({ Bucket: env.B2_BUCKET_NAME, Key: storageKey }));
    const b2Bytes = Buffer.from(await b2Obj.Body!.transformToByteArray());
    expect(b2Bytes.equals(rawImageBytes)).toBe(true);

    // Verify bucket remains private (unauthenticated access must fail)
    const unauthUrl = `${env.B2_ENDPOINT}/${env.B2_BUCKET_NAME}/${storageKey}`;
    const unauthRes = await fetch(unauthUrl);
    expect([401, 403]).toContain(unauthRes.status);

    // C. Emit v2 envelope over Socket.IO
    const v2Envelope = {
      e2ee: true,
      v: 2,
      type: 'image',
      mediaId,
      storageKey,
      mime: 'image/jpeg',
      iv,
      fileSize: rawImageBytes.length,
    };

    const receivePromise = new Promise((resolve) => {
      socketB.once('receive_friend_message', resolve);
    });

    socketA.emit('send_friend_message', {
      roomId,
      senderId: userA.id,
      clientId: 'client-img-e2e',
      envelope: v2Envelope,
    });

    const received: any = await receivePromise;
    expect(received.id).toBeDefined();
    expect(received.envelope).toEqual(v2Envelope);
    expect(received.text).toBeUndefined(); // Crucial: no plaintext or large ciphertext
    expect(received.envelope.ct).toBeUndefined();

    // D. Verify PostgreSQL representation
    const dbMessage = await prisma.message.findUnique({ where: { id: received.id } });
    expect(dbMessage).toBeDefined();
    expect(dbMessage!.content).not.toContain('"ct"');
    expect(dbMessage!.content).not.toContain('data:image');
    expect(Buffer.byteLength(dbMessage!.content, 'utf8')).toBeLessThan(350); // Under 350 bytes

    // Verify MediaAttachment association
    const dbAttachment = await prisma.mediaAttachment.findUnique({ where: { id: mediaId } });
    expect(dbAttachment).toBeDefined();
    expect(dbAttachment!.messageId).toBe(dbMessage!.id);
    expect(dbAttachment!.chatId).toBe(chat.id);
    expect(dbAttachment!.senderId).toBe(userA.id);

    // E. User B downloads via presigned-download
    const presignDownloadRes = await fetch(`http://localhost:3001/media/presigned-download/${mediaId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(presignDownloadRes.status).toBe(200);
    const { downloadUrl } = await presignDownloadRes.json();
    const downloadRes = await fetch(downloadUrl);
    const downloadedBytes = Buffer.from(await downloadRes.arrayBuffer());
    expect(downloadedBytes.equals(rawImageBytes)).toBe(true);
  });

  it('2. Voice Flow: Direct B2 PUT -> v2 envelope -> Socket.IO -> Download & History reload', async () => {
    const rawVoiceBytes = Buffer.from('REAL_RAW_ENCRYPTED_VOICE_AUDIO_DATA_' + Date.now());
    const iv = 'MDEyMzQ1Njc4OWFi';

    // A. Request presigned upload for voice
    const presignRes = await fetch('http://localhost:3001/media/presigned-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        chatId: chat.id,
        mediaType: 'audio',
        mimeType: 'audio/webm',
        fileSize: rawVoiceBytes.length,
        iv,
      }),
    });
    expect(presignRes.status).toBe(201);
    const { mediaId, storageKey, uploadUrl } = await presignRes.json();

    // B. Direct PUT to B2
    const b2PutRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/webm' },
      body: rawVoiceBytes,
    });
    expect(b2PutRes.status).toBe(200);

    // C. Emit v2 envelope over Socket.IO
    const voiceEnvelope = {
      e2ee: true,
      v: 2,
      type: 'audio',
      mediaId,
      storageKey,
      mime: 'audio/webm',
      iv,
      fileSize: rawVoiceBytes.length,
    };

    const receivePromise = new Promise((resolve) => {
      socketB.once('receive_friend_message', resolve);
    });

    socketA.emit('send_friend_message', {
      roomId,
      senderId: userA.id,
      clientId: 'client-voice-e2e',
      envelope: voiceEnvelope,
    });

    const received: any = await receivePromise;
    expect(received.id).toBeDefined();
    expect(received.type).toBe('audio');
    expect(received.envelope).toEqual(voiceEnvelope);

    // D. Test History Reload (friend_room_opened)
    const historyPromise = new Promise((resolve) => {
      socketB.once('friend_room_opened', resolve);
    });
    socketB.emit('open_friend_room', { userId: userB.id, friendId: userA.id });
    const roomData: any = await historyPromise;
    expect(roomData.messages.length).toBeGreaterThan(0);
    const histMsg = roomData.messages.find((m: any) => m.id === received.id);
    expect(histMsg).toBeDefined();
    expect(histMsg.envelope.v).toBe(2);
    expect(histMsg.envelope.mediaId).toBe(mediaId);
    expect(histMsg.text).toBeUndefined();
  });

  it('3. Security: Cross-chat isolation, replay attack rejection, and unauthorized access', async () => {
    console.log('[TEST 3] Creating victim and chat...');
    // Create victim user and chat
    const victim = await prisma.user.create({ data: { username: `victim_${Date.now()}` } });
    const victimChat = await prisma.chat.create({ data: { userAId: victim.id, userBId: userB.id } });
    await prisma.friendship.create({
      data: { userAId: victim.id, userBId: userB.id, chatId: victimChat.id },
    });
    const victimRoomId = `friend-${[victim.id, userB.id].sort().join('-')}`;
    socketB.emit('open_friend_room', { userId: userB.id, friendId: victim.id });
    await new Promise((r) => setTimeout(r, 400));

    console.log('[TEST 3] Requesting presigned upload for User A in chat A...');
    // User A creates an attachment in chat A
    const presignRes = await fetch('http://localhost:3001/media/presigned-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        chatId: chat.id,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        fileSize: 50,
        iv: 'MDEyMzQ1Njc4OWFi',
      }),
    });
    const { mediaId, storageKey } = await presignRes.json();
    console.log('[TEST 3] Obtained mediaId:', mediaId);

    // A. Cross-chat attack: User B tries to claim User A's media in victimChat
    console.log('[TEST 3] Starting cross-chat attack...');
    const crossChatErrorPromise = new Promise((resolve) => {
      socketB.once('friend_message_error', (d) => {
        console.log('[TEST 3] Received friend_message_error for cross-chat:', d);
        resolve(d);
      });
    });
    socketB.emit('send_friend_message', {
      roomId: victimRoomId,
      senderId: userB.id,
      clientId: 'client-cross-attack',
      envelope: {
        e2ee: true,
        v: 2,
        type: 'image',
        mediaId,
        storageKey,
        mime: 'image/jpeg',
        iv: 'MDEyMzQ1Njc4OWFi',
        fileSize: 50,
      },
    });
    const crossErr: any = await crossChatErrorPromise;
    expect(crossErr.message).toContain('unauthorized media attachment');
    console.log('[TEST 3] Cross-chat attack successfully rejected.');

    // B. Replay attack: send mediaId once legitimately, then try to attach it a 2nd time
    console.log('[TEST 3] Starting legitimate send for replay test...');
    const legitPromise = new Promise((resolve) => {
      socketB.once('receive_friend_message', (d) => {
        console.log('[TEST 3] Legit message received by Bob:', d.id);
        resolve(d);
      });
    });
    socketA.emit('send_friend_message', {
      roomId,
      senderId: userA.id,
      clientId: 'legit-msg',
      envelope: {
        e2ee: true,
        v: 2,
        type: 'image',
        mediaId,
        storageKey,
        mime: 'image/jpeg',
        iv: 'MDEyMzQ1Njc4OWFi',
        fileSize: 50,
      },
    });
    await legitPromise;
    console.log('[TEST 3] Now firing replay attack...');

    const replayErrorPromise = new Promise((resolve) => {
      socketA.once('friend_message_error', (d) => {
        console.log('[TEST 3] Received friend_message_error for replay:', d);
        resolve(d);
      });
    });
    socketA.emit('send_friend_message', {
      roomId,
      senderId: userA.id,
      clientId: 'replay-msg',
      envelope: {
        e2ee: true,
        v: 2,
        type: 'image',
        mediaId,
        storageKey,
        mime: 'image/jpeg',
        iv: 'MDEyMzQ1Njc4OWFi',
        fileSize: 50,
      },
    });
    const replayErr: any = await replayErrorPromise;
    expect(replayErr.message).toContain('unauthorized media attachment');
    console.log('[TEST 3] Replay attack successfully rejected.');

    // C. Unauthorized download: Victim tries to get download URL for User A's media
    console.log('[TEST 3] Testing unauthorized download...');
    const victimToken = sessionTokenService.signToken(victim.id);

    const unauthDownloadRes = await fetch(`http://localhost:3001/media/presigned-download/${mediaId}`, {
      headers: { Authorization: `Bearer ${victimToken}` },
    });
    expect(unauthDownloadRes.status).toBe(403);
    console.log('[TEST 3] Unauthorized download rejected with 403.');

    console.log('[TEST 3] Cleaning up victim resources...');
    await prisma.mediaAttachment.deleteMany({ where: { chatId: victimChat.id } });
    await prisma.message.deleteMany({ where: { chatId: victimChat.id } });
    await prisma.friendship.deleteMany({ where: { chatId: victimChat.id } });
    await prisma.chat.deleteMany({ where: { id: victimChat.id } });
    await prisma.user.deleteMany({ where: { id: victim.id } });
    console.log('[TEST 3] Cleaned up.');
  });

  it('4. Stranger Chat Image Flow: Match -> Presigned upload -> Direct B2 PUT -> v2 envelope -> Stranger reception & history', async () => {
    // Set up matched promises
    const matchPromiseA = new Promise((resolve) => socketA.once('matched', resolve));
    const matchPromiseB = new Promise((resolve) => socketB.once('matched', resolve));

    socketA.emit('find_stranger', { language: 'English' });
    socketB.emit('find_stranger', { language: 'English' });

    const [matchA, matchB]: any = await Promise.all([matchPromiseA, matchPromiseB]);
    expect(matchA.roomId).toBe(matchB.roomId);
    expect(matchA.chatId).toBe(matchB.chatId);

    const strangerRoomId = matchA.roomId;
    const strangerChatId = matchA.chatId;

    // Request presigned upload for stranger chat
    const rawStrangerImg = Buffer.from('REAL_STRANGER_IMAGE_DATA_' + Date.now());
    const presignRes = await fetch('http://localhost:3001/media/presigned-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        chatId: strangerChatId,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        fileSize: rawStrangerImg.length,
        iv: 'MDEyMzQ1Njc4OWFi',
      }),
    });
    expect(presignRes.status).toBe(201);
    const { mediaId, storageKey, uploadUrl } = await presignRes.json();

    // Direct PUT to B2
    const b2PutRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: rawStrangerImg,
    });
    expect(b2PutRes.status).toBe(200);

    // Verify object in B2
    const b2Obj = await s3.send(new GetObjectCommand({ Bucket: env.B2_BUCKET_NAME, Key: storageKey }));
    const b2Bytes = Buffer.from(await b2Obj.Body!.transformToByteArray());
    expect(b2Bytes.equals(rawStrangerImg)).toBe(true);

    // Send stranger message with v2 envelope
    const v2Envelope = {
      e2ee: true,
      v: 2,
      type: 'image',
      mediaId,
      storageKey,
      mime: 'image/jpeg',
      iv: 'MDEyMzQ1Njc4OWFi',
      fileSize: rawStrangerImg.length,
    };

    const strangerReceivePromise = new Promise((resolve) => {
      socketB.once('receive_message', resolve);
    });

    socketA.emit('send_message', {
      roomId: strangerRoomId,
      chatId: strangerChatId,
      clientId: 'stranger-client-img-1',
      envelope: v2Envelope,
    });

    const received: any = await strangerReceivePromise;
    expect(received.id).toBeDefined();
    expect(received.envelope).toEqual(v2Envelope);
    expect(received.text).toBeUndefined();

    // Verify DB
    const dbMsg = await prisma.message.findUnique({ where: { id: received.id } });
    expect(dbMsg).toBeDefined();
    expect(dbMsg!.content).not.toContain('"ct"');
    expect(Buffer.byteLength(dbMsg!.content, 'utf8')).toBeLessThan(350);

    const dbAttachment = await prisma.mediaAttachment.findUnique({ where: { id: mediaId } });
    expect(dbAttachment!.messageId).toBe(dbMsg!.id);
    expect(dbAttachment!.chatId).toBe(strangerChatId);

    // User B downloads via presigned-download
    const presignDownloadRes = await fetch(`http://localhost:3001/media/presigned-download/${mediaId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(presignDownloadRes.status).toBe(200);
    const { downloadUrl } = await presignDownloadRes.json();
    const downloadRes = await fetch(downloadUrl);
    const downloadedImg = Buffer.from(await downloadRes.arrayBuffer());
    expect(downloadedImg.equals(rawStrangerImg)).toBe(true);
  });

  it('5. Stranger Chat Voice Flow: Presigned upload -> Direct B2 PUT -> v2 envelope -> Stranger reception & audio playback check', async () => {
    // Current stranger session from test 4 is still active
    const activeSessionA = await fetch('http://localhost:3001/users/' + userA.id + '/profile');
    // Send voice note in existing active stranger room
    const dbStrangerChat = await prisma.chat.findFirst({
      where: {
        OR: [
          { userAId: userA.id, userBId: userB.id },
          { userAId: userB.id, userBId: userA.id },
        ],
        endedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(dbStrangerChat).toBeDefined();
    const strangerChatId = dbStrangerChat!.id;

    const rawStrangerVoice = Buffer.from('REAL_STRANGER_VOICE_AUDIO_DATA_' + Date.now());
    const presignRes = await fetch('http://localhost:3001/media/presigned-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        chatId: strangerChatId,
        mediaType: 'audio',
        mimeType: 'audio/webm',
        fileSize: rawStrangerVoice.length,
        iv: 'MDEyMzQ1Njc4OWFi',
      }),
    });
    expect(presignRes.status).toBe(201);
    const { mediaId, storageKey, uploadUrl } = await presignRes.json();

    const b2PutRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/webm' },
      body: rawStrangerVoice,
    });
    expect(b2PutRes.status).toBe(200);

    const voiceEnvelope = {
      e2ee: true,
      v: 2,
      type: 'audio',
      mediaId,
      storageKey,
      mime: 'audio/webm',
      iv: 'MDEyMzQ1Njc4OWFi',
      fileSize: rawStrangerVoice.length,
    };

    const strangerReceivePromise = new Promise((resolve) => {
      socketB.once('receive_message', resolve);
    });

    socketA.emit('send_message', {
      chatId: strangerChatId,
      clientId: 'stranger-client-voice-1',
      envelope: voiceEnvelope,
    });

    const received: any = await strangerReceivePromise;
    expect(received.id).toBeDefined();
    expect(received.type).toBe('audio');
    expect(received.envelope).toEqual(voiceEnvelope);

    // User B downloads via presigned-download
    const presignDownloadRes = await fetch(`http://localhost:3001/media/presigned-download/${mediaId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(presignDownloadRes.status).toBe(200);
    const { downloadUrl } = await presignDownloadRes.json();
    const downloadRes = await fetch(downloadUrl);
    const downloadedAudio = Buffer.from(await downloadRes.arrayBuffer());
    expect(downloadedAudio.equals(rawStrangerVoice)).toBe(true);

    // End stranger chat
    socketA.emit('end_chat');
    await new Promise((r) => setTimeout(r, 400));
  });
});
