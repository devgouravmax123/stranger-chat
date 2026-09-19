import { io } from 'socket.io-client';
import fs from 'fs';
import path from 'path';

// CLI parameters
const concurrency = parseInt(process.env.CONCURRENCY || process.argv[2] || '50', 10);
const durationMs = parseInt(process.env.DURATION_MS || '60000', 10);
const rampUpMs = parseInt(process.env.RAMP_UP_MS || '0', 10);
const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';

console.log(`\n======================================================`);
console.log(`⚡ SOCKET.IO CONCURRENCY HARNESS: ${concurrency} SIMULTANEOUS USERS`);
console.log(`Target: ${serverUrl} | Ramp-Up: ${rampUpMs / 1000}s | Sustained Duration: ${durationMs / 1000}s`);
console.log(`======================================================\n`);

const metrics = {
  totalAttempted: concurrency,
  connected: 0,
  connectErrors: 0,
  socketErrors: 0,
  socketDisconnects: 0,
  waitingQueued: 0,
  matchmakingAttempts: 0,
  matchedCount: 0,
  messagesSent: 0,
  messagesReceived: 0,
  connectTimes: [],
  queueWaitTimes: [],      // Time spent waiting in queue until a partner arrives
  matchExecutionTimes: [], // Pure backend match execution time (arrival to match event received)
  intervals: [],
};

const sockets = [];
const startTime = Date.now();
let isTearingDown = false;
let monitorInterval = null;

function percentile(arr, p) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return 0;
  const valid = arr
    .map(Number)
    .filter((n) => !isNaN(n) && isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const idx = Math.min(Math.floor((p / 100) * valid.length), valid.length - 1);
  return Math.round(valid[idx]);
}

function average(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return 0;
  const valid = arr
    .map(Number)
    .filter((n) => !isNaN(n) && isFinite(n) && n >= 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, v) => acc + v, 0);
  return parseFloat((sum / valid.length).toFixed(1));
}

async function run() {
  console.log(`Connecting ${concurrency} concurrent client sockets in staggered batches...`);

  for (let i = 0; i < concurrency; i++) {
    const hex = (i + 1).toString(16).padStart(12, '0');
    const userId = `00000000-0000-4000-8000-${hex}`;
    const connStart = Date.now();

    const socket = io(serverUrl, {
      transports: ['websocket'],
      auth: { userId },
      timeout: 10000,
      reconnection: false,
    });

    let queueEnterTime = 0;
    let didWaitInQueue = false;
    let currentRoomId = null;
    let actualUserId = null;

    socket.on('connect', () => {
      metrics.connected++;
      metrics.connectTimes.push(Date.now() - connStart);
    });

    socket.on('user_ready', (data) => {
      actualUserId = data.userId;
      socket.emit('friend_online', { userId: actualUserId });

      // Join stranger matchmaking queue after staggered delay (100-600ms)
      setTimeout(() => {
        if (!socket.connected || isTearingDown) return;
        queueEnterTime = Date.now();
        metrics.matchmakingAttempts++;
        socket.emit('find_stranger', {
          language: 'English',
          interests: ['Coding', 'Gaming', 'Music'],
          goal: 'casual-chat',
        });
      }, Math.random() * 500 + 100);
    });

    socket.on('connect_error', (err) => {
      metrics.connectErrors++;
    });

    socket.on('error', (err) => {
      metrics.socketErrors++;
    });

    socket.on('disconnect', (reason) => {
      if (!isTearingDown) {
        metrics.socketDisconnects++;
      }
    });

    socket.on('waiting', () => {
      metrics.waitingQueued++;
      didWaitInQueue = true;
    });

    socket.on('matched', (data) => {
      metrics.matchedCount++;
      if (queueEnterTime > 0) {
        const totalDuration = Date.now() - queueEnterTime;
        if (didWaitInQueue) {
          // Socket was queued and waited for a counterpart to arrive
          metrics.queueWaitTimes.push(totalDuration);
        } else {
          // Socket matched immediately upon arrival (direct match execution)
          metrics.matchExecutionTimes.push(totalDuration);
        }
      }
      currentRoomId = data.roomId;

      // Send first message shortly after match (300ms)
      setTimeout(() => {
        if (socket.connected && currentRoomId && !isTearingDown) {
          const sendTs = Date.now();
          metrics.messagesSent++;
          socket.emit('send_message', {
            roomId: currentRoomId,
            text: `Load test hello from client ${i}`,
            clientId: `msg-${i}-${sendTs}`,
          });
        }
      }, 300);

      // Sustain ongoing message exchange throughout the session (every 4-6s)
      const chatInterval = setInterval(() => {
        if (socket.connected && currentRoomId && !isTearingDown) {
          const sendTs = Date.now();
          metrics.messagesSent++;
          socket.emit('send_message', {
            roomId: currentRoomId,
            text: `Sustained chat ping from client ${i} at ${Date.now()}`,
            clientId: `msg-${i}-${sendTs}`,
          });
        } else {
          clearInterval(chatInterval);
        }
      }, 4000 + Math.random() * 2000);

      metrics.intervals.push(chatInterval);
    });

    socket.on('receive_message', (msg) => {
      metrics.messagesReceived++;
    });

    sockets.push(socket);

    // Controlled ramp-up: if rampUpMs > 0, spread connection attempts evenly across rampUpMs
    if (rampUpMs > 0) {
      const delayPerClient = rampUpMs / concurrency;
      await new Promise((resolve) => setTimeout(resolve, delayPerClient));
    } else if (i % 25 === 0 && i > 0) {
      // Default fast batching (25 clients per 50ms)
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // Monitor progress during run
  monitorInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const totalSecs = Math.round((rampUpMs + durationMs) / 1000);
    process.stdout.write(
      `\r[${elapsed}s/${totalSecs}s] Connected: ${metrics.connected}/${concurrency} | Queued: ${metrics.waitingQueued} | Matched: ${metrics.matchedCount} | Msgs: ${metrics.messagesSent} sent / ${metrics.messagesReceived} recv`
    );
  }, 1000);

  try {
    // Wait for the full test duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  } finally {
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
    isTearingDown = true;
    metrics.intervals.forEach((id) => clearInterval(id));
  }

  // Allow brief 1s drain window for in-flight messages to arrive before closing sockets
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('\n\nTest duration completed. Closing all client sockets...');

  for (const s of sockets) {
    try {
      s.removeAllListeners();
      s.disconnect();
    } catch (_) {}
  }

  // Calculate final statistics
  const totalDurationSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  const connectionSuccessRate = metrics.totalAttempted > 0
    ? parseFloat(((metrics.connected / metrics.totalAttempted) * 100).toFixed(2))
    : 0;
  const matchSuccessRate = metrics.matchmakingAttempts > 0
    ? parseFloat(((metrics.matchedCount / metrics.matchmakingAttempts) * 100).toFixed(2))
    : 0;
  const matchedPairsCount = Math.floor(metrics.matchedCount / 2);
  const unmatchedUsersCount = Math.max(0, metrics.matchmakingAttempts - metrics.matchedCount);

  const results = {
    tier: `${concurrency}_users`,
    concurrency,
    durationSeconds: totalDurationSeconds,
    connections: {
      attempted: metrics.totalAttempted,
      connected: metrics.connected,
      successful: metrics.connected,
      failed: metrics.connectErrors,
      connectionSuccessRatePercent: connectionSuccessRate,
      latencyMs: {
        avg: average(metrics.connectTimes),
        p50: percentile(metrics.connectTimes, 50),
        p95: percentile(metrics.connectTimes, 95),
        p99: percentile(metrics.connectTimes, 99),
      },
    },
    matchmaking: {
      attempts: metrics.matchmakingAttempts,
      successfulMatches: metrics.matchedCount,
      matchedPairsCount,
      unmatchedUsers: unmatchedUsersCount,
      matchmakingSuccessRatePercent: matchSuccessRate,
      queueWaitLatencyMs: {
        avg: average(metrics.queueWaitTimes),
        p50: percentile(metrics.queueWaitTimes, 50),
        p95: percentile(metrics.queueWaitTimes, 95),
        p99: percentile(metrics.queueWaitTimes, 99),
      },
      matchExecutionLatencyMs: {
        avg: average(metrics.matchExecutionTimes),
        p50: percentile(metrics.matchExecutionTimes, 50),
        p95: percentile(metrics.matchExecutionTimes, 95),
        p99: percentile(metrics.matchExecutionTimes, 99),
      },
      // Backward compatibility field
      matchLatencyMs: {
        avg: average(metrics.matchExecutionTimes.length > 0 ? metrics.matchExecutionTimes : metrics.queueWaitTimes),
        p50: percentile(metrics.matchExecutionTimes.length > 0 ? metrics.matchExecutionTimes : metrics.queueWaitTimes, 50),
        p95: percentile(metrics.matchExecutionTimes.length > 0 ? metrics.matchExecutionTimes : metrics.queueWaitTimes, 95),
        p99: percentile(metrics.matchExecutionTimes.length > 0 ? metrics.matchExecutionTimes : metrics.queueWaitTimes, 99),
      },
    },
    messaging: {
      sent: metrics.messagesSent,
      received: metrics.messagesReceived,
      deliveryDefinition: 'Messages received by room counterpart via receive_message event during active session.',
    },
    errors: {
      connectErrors: metrics.connectErrors,
      socketErrors: metrics.socketErrors,
      socketDisconnects: metrics.socketDisconnects,
      totalErrors: metrics.connectErrors + metrics.socketErrors + metrics.socketDisconnects,
    },
    timestamp: new Date().toISOString(),
  };

  console.log('\n------------------------------------------------------');
  console.log('SOCKET.IO RESULTS SUMMARY:');
  console.log(`- Connection Count: ${results.connections.connected} / ${results.connections.attempted}`);
  console.log(`- Connection Success %: ${results.connections.connectionSuccessRatePercent}%`);
  console.log(`- Connection Latency: avg=${results.connections.latencyMs.avg}ms, p50=${results.connections.latencyMs.p50}ms, p95=${results.connections.latencyMs.p95}ms, p99=${results.connections.latencyMs.p99}ms`);
  console.log(`- Matchmaking Attempts: ${results.matchmaking.attempts}`);
  console.log(`- Successful Matches: ${results.matchmaking.successfulMatches} (${results.matchmaking.matchedPairsCount} pairs)`);
  console.log(`- Unmatched Users: ${results.matchmaking.unmatchedUsers} (simultaneous arrivals pending in queue at cutoff)`);
  console.log(`- Matchmaking Success %: ${results.matchmaking.matchmakingSuccessRatePercent}%`);
  console.log(`- Queue Wait Latency (Passive): avg=${results.matchmaking.queueWaitLatencyMs.avg}ms, p50=${results.matchmaking.queueWaitLatencyMs.p50}ms, p95=${results.matchmaking.queueWaitLatencyMs.p95}ms, p99=${results.matchmaking.queueWaitLatencyMs.p99}ms`);
  console.log(`- Match Execution Latency (Backend): avg=${results.matchmaking.matchExecutionLatencyMs.avg}ms, p50=${results.matchmaking.matchExecutionLatencyMs.p50}ms, p95=${results.matchmaking.matchExecutionLatencyMs.p95}ms, p99=${results.matchmaking.matchExecutionLatencyMs.p99}ms`);
  console.log(`- Messages Sent: ${results.messaging.sent}`);
  console.log(`- Messages Received: ${results.messaging.received}`);
  console.log(`- Socket Errors/Disconnects: errors=${results.errors.socketErrors}, connectErrors=${results.errors.connectErrors}, unexpectedDisconnects=${results.errors.socketDisconnects}`);
  console.log('------------------------------------------------------\n');

  // Save results
  const resultsDir = path.resolve('load-tests/results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  const resultFilePath = path.join(resultsDir, `socketio-${concurrency}-users.json`);
  fs.writeFileSync(resultFilePath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved detailed Socket.IO results to ${resultFilePath}`);

  setTimeout(() => {
    process.exit(0);
  }, 100);

  return results;
}

run().catch((err) => {
  console.error('Harness error:', err);
  if (monitorInterval) clearInterval(monitorInterval);
  process.exit(1);
});
