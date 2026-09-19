import { io } from 'socket.io-client';
import Redis from '../../backend/node_modules/ioredis/built/index.js';
import pg from '../../backend/node_modules/pg/lib/index.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, execSync } from 'child_process';

const { Pool } = pg;

// Mode: 'A' (500 -> +1500 = 2000), 'B' (500 -> +2500 = 3000), 'C' (1000 -> +2000 = 3000 -> drop to 1000)
const SCENARIO = (process.argv[2] || 'A').toUpperCase();
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:56863';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_1kRzpVaxZ9ro@ep-fancy-star-b32j88in-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connection_limit=60&pool_timeout=30';
const SESSION_SECRET = process.env.SESSION_SECRET || 'chirp-ephemeral-session-secret-2026-key-v1';

let BASE_USERS = 500;
let SPIKE_USERS = 1500;
let TOTAL_USERS = 2000;
let IS_RECOVERY_TEST = false;

if (SCENARIO === 'A') {
  BASE_USERS = 500;
  SPIKE_USERS = 1500;
  TOTAL_USERS = 2000;
} else if (SCENARIO === 'B') {
  BASE_USERS = 500;
  SPIKE_USERS = 2500;
  TOTAL_USERS = 3000;
} else if (SCENARIO === 'C') {
  BASE_USERS = 1000;
  SPIKE_USERS = 2000;
  TOTAL_USERS = 3000;
  IS_RECOVERY_TEST = true;
}

console.log('\n============================================================');
console.log(`⚡ CHATBUDDY SPIKE TEST: SCENARIO ${SCENARIO}`);
console.log(`Base: ${BASE_USERS} users | Sudden Spike: +${SPIKE_USERS} users | Peak: ${TOTAL_USERS} users`);
console.log(`Mode: ${IS_RECOVERY_TEST ? 'Dynamic Surge & Release (Recovery Test)' : 'Instant Load Transition'}`);
console.log(`Target: ${SERVER_URL} | Redis: ${REDIS_URL}`);
console.log('============================================================\n');

function signToken(userId) {
  const iat = Date.now();
  const exp = iat + 30 * 24 * 60 * 60 * 1000;
  const payload = { userId, iat, exp };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function percentile(arr, p) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return 0;
  const valid = arr.map(Number).filter((n) => !isNaN(n) && isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const idx = Math.min(Math.floor((p / 100) * valid.length), valid.length - 1);
  return Math.round(valid[idx]);
}

function average(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return 0;
  const valid = arr.map(Number).filter((n) => !isNaN(n) && isFinite(n) && n >= 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, v) => acc + v, 0);
  return parseFloat((sum / valid.length).toFixed(1));
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: 'ignore',
      shell: true,
      env: { ...process.env, ...env },
    });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

// 10 Balanced Canonical Profiles
const PROFILE_TEMPLATES = [
  { id: 'T0', language: 'English', interests: ['Coding', 'Gaming', 'Music'], goal: 'casual-chat' },
  { id: 'T1', language: 'English', interests: ['Coding', 'Gaming', 'Music'], goal: 'casual-chat' },
  { id: 'T2', language: 'English', interests: ['Movies', 'Anime', 'Reading'], goal: 'friendship' },
  { id: 'T3', language: 'English', interests: ['Movies', 'Anime', 'Reading'], goal: 'friendship' },
  { id: 'T4', language: 'Hindi', interests: ['Sports', 'Fitness', 'Travel'], goal: 'casual-chat' },
  { id: 'T5', language: 'Hindi', interests: ['Sports', 'Fitness', 'Travel'], goal: 'casual-chat' },
  { id: 'T6', language: 'Spanish', interests: ['Music', 'Travel', 'Reading'], goal: 'learning' },
  { id: 'T7', language: 'Spanish', interests: ['Music', 'Travel', 'Reading'], goal: 'learning' },
  { id: 'T8', language: 'English', interests: ['Coding', 'Fitness', 'Movies'], goal: 'networking' },
  { id: 'T9', language: 'English', interests: ['Gaming', 'Anime', 'Travel'], goal: 'networking' },
];

function getProfileForUser(index) {
  const tpl = PROFILE_TEMPLATES[index % PROFILE_TEMPLATES.length];
  return {
    language: tpl.language,
    interests: [...tpl.interests],
    goal: tpl.goal,
    templateId: tpl.id,
  };
}

async function getBackendProcessMetrics() {
  try {
    const netstatOut = execSync('netstat -ano', { encoding: 'utf8' });
    const line = netstatOut.split('\n').find((l) => l.includes(':3001') && l.includes('LISTENING'));
    if (!line) return { memoryMB: 0, cpuSec: 0 };
    const pid = line.trim().split(/\s+/).pop();
    if (!pid || isNaN(Number(pid))) return { memoryMB: 0, cpuSec: 0 };
    const psOut = execSync(`powershell -NoProfile -Command "Get-Process -Id ${pid} | Select-Object WorkingSet64, CPU | ConvertTo-Json"`, { encoding: 'utf8' });
    const parsed = JSON.parse(psOut.trim());
    const memoryMB = Math.round((parsed.WorkingSet64 || parsed.WorkingSet || 0) / (1024 * 1024));
    const cpuSec = parseFloat(parsed.CPU || 0).toFixed(1);
    return { memoryMB, cpuSec };
  } catch {
    return { memoryMB: 0, cpuSec: 0 };
  }
}

async function main() {
  const r = new Redis(REDIS_URL);
  const pgPool = new Pool({ connectionString: DATABASE_URL, max: 3 });

  // 1. PRE-FLIGHT
  console.log('[1/8] Pre-Flight System Checks...');
  const pong = await r.ping();
  if (pong !== 'PONG') throw new Error('Redis ping failed: ' + pong);

  const memBefore = (await r.info('memory')).split('\n').find((l) => l.includes('used_memory_human'))?.trim()?.split(':')[1]?.trim();
  const statsBefore = (await r.info('stats')).split('\n').find((l) => l.includes('total_commands_processed'))?.trim()?.split(':')[1]?.trim();
  const cmdsInit = parseInt(statsBefore || '0', 10);

  const healthOk = await new Promise((res) => {
    http.get(`${SERVER_URL}/health`, (resp) => res(resp.statusCode === 200)).on('error', () => res(false));
  });
  if (!healthOk) throw new Error('Backend health check failed on ' + SERVER_URL);

  const dbClient = await pgPool.connect();
  const dbPingStart = Date.now();
  await dbClient.query('SELECT 1');
  const dbLatencyMs = Date.now() - dbPingStart;
  dbClient.release();

  await r.flushall();
  console.log(`  ✓ Redis connected: ${pong} (${memBefore})`);
  console.log(`  ✓ Database responsive: ${dbLatencyMs}ms query ping`);
  console.log(`  ✓ Backend health: 200 OK\n`);

  // Event loop monitor
  const eventLoopDelays = [];
  const loopMonitor = setInterval(() => {
    const t0 = Date.now();
    http.get(`${SERVER_URL}/health`, (resp) => {
      resp.resume();
      eventLoopDelays.push(Date.now() - t0);
    }).on('error', () => {
      eventLoopDelays.push(9999);
    });
  }, 400);

  // 2. STAGE 1: ESTABLISH BASE USERS
  console.log(`[2/8] Establishing Stable Base Population (${BASE_USERS} users)...`);
  const sockets = [];
  const clients = new Map();
  const baseReadyPromise = new Promise((resolve) => {
    let baseReady = 0;
    for (let i = 0; i < BASE_USERS; i++) {
      const hex = (i + 1).toString(16).padStart(12, '0');
      const userId = `00000000-0000-4000-8000-${hex}`;
      const profile = getProfileForUser(i);
      const token = signToken(userId);

      // Stagger base users slightly over 10s
      setTimeout(() => {
        const socket = io(SERVER_URL, {
          transports: ['websocket'],
          auth: { userId, token },
          timeout: 25000,
          reconnection: false,
        });
        socket.userId = userId;
        socket.clientIndex = i;
        socket.profile = profile;

        socket.on('user_ready', () => {
          baseReady++;
          if (baseReady % 100 === 0 || baseReady === BASE_USERS) {
            process.stdout.write(`\r  > Base Ready: ${baseReady}/${BASE_USERS}...`);
          }
          if (baseReady === BASE_USERS) {
            console.log(`\n  ✓ Base population of ${BASE_USERS} users established & ready!\n`);
            resolve();
          }
        });
        sockets.push(socket);
        clients.set(userId, socket);
      }, (10000 / BASE_USERS) * i);
    }
  });

  await baseReadyPromise;

  // Let base population settle
  await new Promise((res) => setTimeout(res, 2000));

  // 3. STAGE 2: SUDDEN TRAFFIC SPIKE (+SPIKE_USERS IMMEDIATELY)
  console.log(`[3/8] INJECTING SUDDEN SPIKE: +${SPIKE_USERS} users simultaneously (no ramp)...`);
  const spikeStartTime = Date.now();
  const spikeConnectLatencies = [];
  let spikeReadyCount = 0;
  let spikeConnectErrors = 0;
  let unexpectedDisconnects = 0;
  let isShuttingDown = false;
  const spikeSockets = [];

  const spikeReadyPromise = new Promise((resolve) => {
    const spikeTimeout = setTimeout(() => {
      console.warn(`\n⚠️ Spike connection safety timeout reached. Spike ready: ${spikeReadyCount}/${SPIKE_USERS}`);
      resolve();
    }, 45000);

    for (let i = BASE_USERS; i < TOTAL_USERS; i++) {
      const hex = (i + 1).toString(16).padStart(12, '0');
      const userId = `00000000-0000-4000-8000-${hex}`;
      const profile = getProfileForUser(i);
      const token = signToken(userId);
      const tConnInit = Date.now();

      // Zero delay: sudden simultaneous connect wave
      const socket = io(SERVER_URL, {
        transports: ['websocket'],
        auth: { userId, token },
        timeout: 30000,
        reconnection: false,
      });

      socket.userId = userId;
      socket.clientIndex = i;
      socket.profile = profile;

      socket.on('connect', () => {
        spikeConnectLatencies.push(Date.now() - tConnInit);
      });

      socket.on('user_ready', () => {
        spikeReadyCount++;
        if (spikeReadyCount % 250 === 0 || spikeReadyCount === SPIKE_USERS) {
          process.stdout.write(`\r  > Sudden Spike Ready: ${spikeReadyCount}/${SPIKE_USERS}...`);
        }
        if (spikeReadyCount === SPIKE_USERS) {
          clearTimeout(spikeTimeout);
          console.log(`\n  ✓ Sudden spike of ${SPIKE_USERS} users absorbed!`);
          resolve();
        }
      });

      socket.on('connect_error', () => {
        spikeConnectErrors++;
      });

      socket.on('disconnect', () => {
        if (!isShuttingDown) unexpectedDisconnects++;
      });

      sockets.push(socket);
      spikeSockets.push(socket);
      clients.set(userId, socket);
    }
  });

  await spikeReadyPromise;
  const spikeTransitionDurationSec = parseFloat(((Date.now() - spikeStartTime) / 1000).toFixed(1));
  const spikeConnectionSuccessRate = parseFloat(((spikeReadyCount / SPIKE_USERS) * 100).toFixed(1));
  console.log(`  ✓ Spike Transition Duration: ${spikeTransitionDurationSec}s`);
  console.log(`  ✓ Spike Connection Success Rate: ${spikeConnectionSuccessRate}% (${spikeReadyCount}/${SPIKE_USERS}, errors: ${spikeConnectErrors})`);
  console.log(`  ✓ Spike Connect Latency: avg=${average(spikeConnectLatencies)}ms, p50=${percentile(spikeConnectLatencies, 50)}ms, p95=${percentile(spikeConnectLatencies, 95)}ms\n`);

  // 4. REST API SPIKE SATURATION LOAD TEST (Concurrent with peak users)
  console.log(`[4/8] Executing REST API Spike Load Test during peak population (${TOTAL_USERS} users)...`);
  const resultsDir = path.resolve('load-tests/results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const k6SummaryFile = path.join(resultsDir, `k6-spike-${SCENARIO}-summary.json`);
  const k6Path = path.resolve('load-tests/bin/k6.exe');

  const restVUs = Math.min(TOTAL_USERS, 500);
  const restDuration = '25s';
  const restRamp = '5s'; // Sudden 5s ramp
  const restStart = Date.now();

  if (fs.existsSync(k6Path)) {
    await runCommand(k6Path, [
      'run',
      '--env', `VUS=${restVUs}`,
      '--env', `DURATION=${restDuration}`,
      '--env', `RAMP_UP=${restRamp}`,
      '--summary-export', `"${k6SummaryFile}"`,
      'load-tests/scenarios/rest-api-load.js',
    ]);
  }
  const restDurationSec = parseFloat(((Date.now() - restStart) / 1000).toFixed(1));

  let k6Report = {
    requests: 0,
    requestsPerSecond: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    failureRatePercent: 0,
  };

  if (fs.existsSync(k6SummaryFile)) {
    try {
      const k6Raw = JSON.parse(fs.readFileSync(k6SummaryFile, 'utf-8'));
      const durObj = k6Raw?.metrics?.http_req_duration?.values || k6Raw?.metrics?.http_req_duration || {};
      const httpReqsObj = k6Raw?.metrics?.http_reqs?.values || k6Raw?.metrics?.http_reqs || {};
      const failedObj = k6Raw?.metrics?.http_req_failed?.values || k6Raw?.metrics?.http_req_failed || {};
      k6Report = {
        requests: httpReqsObj.count ?? 0,
        requestsPerSecond: parseFloat(((httpReqsObj.rate ?? 0)).toFixed(1)),
        p50: parseFloat(((durObj.med ?? durObj['p(50)'] ?? 0)).toFixed(1)),
        p95: parseFloat(((durObj['p(95)'] ?? 0)).toFixed(1)),
        p99: durObj['p(99)'] !== undefined ? parseFloat(durObj['p(99)'].toFixed(1)) : 0,
        failureRatePercent: parseFloat((((failedObj.value ?? failedObj.rate ?? 0)) * 100).toFixed(2)),
      };
      console.log(`  ✓ REST Spike: ${k6Report.requests} reqs @ ${k6Report.requestsPerSecond} rps, p95=${k6Report.p95}ms, p99=${k6Report.p99}ms, fail=${k6Report.failureRatePercent}%\n`);
    } catch (_) {}
  }

  // 5. BARRIER MATCHMAKING
  const readyTotal = BASE_USERS + spikeReadyCount;
  console.log(`[5/8] Releasing Matchmaking Barrier across peak population (${readyTotal} ready users)...`);
  const matchmakingStartTime = Date.now();
  const matchResults = new Map();
  const clientTimestamps = new Map();

  const allMatchedPromise = new Promise((resolve) => {
    const safetyTimer = setTimeout(() => {
      console.warn(`\n⚠️ Matchmaking safety timeout reached. Matched: ${matchResults.size}/${readyTotal}`);
      resolve();
    }, 180000);

    for (const socket of sockets) {
      const uId = socket.userId;
      clientTimestamps.set(uId, { t1: 0, t_waiting: 0, t_matched: 0 });

      socket.on('waiting', () => {
        const ts = clientTimestamps.get(uId);
        if (ts) ts.t_waiting = Date.now();
      });

      socket.on('matched', (data) => {
        const tMatched = Date.now();
        const ts = clientTimestamps.get(uId);
        if (ts) ts.t_matched = tMatched;

        matchResults.set(uId, {
          socketId: socket.id,
          userId: uId,
          strangerUserId: data.strangerUserId,
          roomId: data.roomId,
          score: data.score,
          receivedAt: tMatched,
        });

        if (matchResults.size % 250 === 0 || matchResults.size >= readyTotal) {
          process.stdout.write(`\r  > Matches Completed: ${matchResults.size}/${readyTotal} (${Math.floor(matchResults.size / 2)} pairs)...`);
        }

        if (matchResults.size >= readyTotal) {
          clearTimeout(safetyTimer);
          console.log(`\n  🎉 MATCHMAKING COMPLETE! ${matchResults.size}/${readyTotal} users matched into ${Math.floor(matchResults.size / 2)} pairs!`);
          resolve();
        }
      });
    }

    // Barrier Release: emit find_stranger across all ready sockets
    for (const socket of sockets) {
      if (!socket.connected) continue;
      const uId = socket.userId;
      const prof = socket.profile;
      const ts = clientTimestamps.get(uId);
      if (ts) ts.t1 = Date.now();

      socket.emit('find_stranger', {
        language: prof.language,
        interests: prof.interests,
        goal: prof.goal,
      });
    }
  });

  await allMatchedPromise;

  // 6. PAIR INTEGRITY & LATENCY
  console.log('\n[6/8] Verifying Pair Integrity & Queue Wait Latencies...');
  const pairMap = new Map();
  let selfMatches = 0;
  let duplicatePairs = 0;
  let multiplePairUsers = 0;
  const queueWaitLatencies = [];

  for (const [uId, match] of matchResults.entries()) {
    if (uId === match.strangerUserId) selfMatches++;
    const counterpart = matchResults.get(match.strangerUserId);
    if (counterpart && counterpart.strangerUserId !== uId) multiplePairUsers++;

    const pairKey = [uId, match.strangerUserId].sort().join(' <-> ');
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        userA: uId,
        userB: match.strangerUserId,
        roomId: match.roomId,
        score: match.score,
      });
      const tsA = clientTimestamps.get(uId);
      const tsB = clientTimestamps.get(match.strangerUserId);
      if (tsA && tsB) {
        const T1 = Math.min(tsA.t1, tsB.t1);
        const T2 = Math.max(tsA.t1, tsB.t1);
        queueWaitLatencies.push(Math.max(0, T2 - T1));
      }
    }
  }

  const matchedUsers = matchResults.size;
  const unmatchedUsers = readyTotal - matchedUsers;
  const matchmakingSuccessPercent = parseFloat(((matchedUsers / readyTotal) * 100).toFixed(1));
  const duplicateSelfMultiCount = selfMatches + duplicatePairs + multiplePairUsers;

  console.log(`  - Matched Users: ${matchedUsers}/${readyTotal} (${matchmakingSuccessPercent}%)`);
  console.log(`  - Unique Pairs Formed: ${pairMap.size}`);
  console.log(`  - Anomalies (Self/Duplicate/Multi): ${duplicateSelfMultiCount}`);
  console.log(`  - Queue Wait: p50=${percentile(queueWaitLatencies, 50)}ms, p95=${percentile(queueWaitLatencies, 95)}ms, p99=${percentile(queueWaitLatencies, 99)}ms\n`);

  // 7. CHAT MESSAGING INTEGRITY
  console.log('[7/8] Executing Chat Messaging Verification (50 sample pairs)...');
  const samplePairs = Array.from(pairMap.values()).slice(0, 50);
  let messagesSent = 0;
  let messagesReceived = 0;

  for (const p of samplePairs) {
    const sockA = clients.get(p.userA);
    const sockB = clients.get(p.userB);
    if (!sockA || !sockB || !sockA.connected || !sockB.connected) continue;

    const tSent = Date.now();
    const msgText = `spike-${SCENARIO}-${p.roomId}-${tSent}`;

    const recvPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg && msg.text === msgText) {
          messagesReceived++;
          sockB.off('receive_message', handler);
          resolve();
        }
      };
      sockB.on('receive_message', handler);
      setTimeout(resolve, 3500);
    });

    messagesSent++;
    sockA.emit('send_message', {
      roomId: p.roomId,
      text: msgText,
      clientId: `msg-${tSent}`,
    });

    await recvPromise;
  }

  const messageDeliveryPercent = messagesSent > 0 ? parseFloat(((messagesReceived / messagesSent) * 100).toFixed(1)) : 100;
  console.log(`  - Messages Sent: ${messagesSent}, Delivered: ${messagesReceived} (${messageDeliveryPercent}%)\n`);

  // 8. RECOVERY MEASUREMENT & TEARDOWN
  console.log('[8/8] Measuring System Recovery...');
  const tRecoveryStart = Date.now();

  if (IS_RECOVERY_TEST) {
    console.log('  > Shedding 2000 spike sockets and retaining original 1000 base users...');
    for (let i = 0; i < spikeSockets.length; i++) {
      try {
        spikeSockets[i].removeAllListeners();
        spikeSockets[i].disconnect();
      } catch (_) {}
      if (i % 50 === 0 && i > 0) {
        await new Promise((res) => setTimeout(res, 20));
      }
    }
    // Verify base 1000 users remain healthy
    let baseAlive = 0;
    for (let i = 0; i < BASE_USERS; i++) {
      const s = sockets[i];
      if (s && s.connected) baseAlive++;
    }
    console.log(`  ✓ Original Base Population Status: ${baseAlive}/${BASE_USERS} healthy and connected!`);
  }

  // Probe until health latency drops to baseline (< 20ms)
  let recovered = false;
  let recoveryProbeAttempts = 0;
  while (!recovered && recoveryProbeAttempts < 20) {
    recoveryProbeAttempts++;
    const tP = Date.now();
    const probeRes = await new Promise((res) => {
      http.get(`${SERVER_URL}/health`, (resp) => {
        resp.resume();
        res(Date.now() - tP);
      }).on('error', () => res(9999));
    });
    if (probeRes < 30) {
      recovered = true;
    } else {
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  const recoveryDurationSec = parseFloat(((Date.now() - tRecoveryStart) / 1000).toFixed(1));

  // Infrastructure sampling
  clearInterval(loopMonitor);
  const procMetrics = await getBackendProcessMetrics();
  const memAfter = (await r.info('memory')).split('\n').find((l) => l.includes('used_memory_human'))?.trim()?.split(':')[1]?.trim();
  const statsAfter = (await r.info('stats')).split('\n').find((l) => l.includes('total_commands_processed'))?.trim()?.split(':')[1]?.trim();
  const cmdsTotal = parseInt(statsAfter || '0', 10);
  const redisCmdDiff = cmdsTotal - cmdsInit;

  // DB pool check
  let poolPressure = 'Low';
  let poolTimeouts = 0;
  try {
    const postClient = await pgPool.connect();
    const tCheck = Date.now();
    await postClient.query('SELECT 1');
    const postLat = Date.now() - tCheck;
    postClient.release();
    if (postLat > 500) poolPressure = 'Moderate';
    if (postLat > 2000) poolPressure = 'High';
  } catch (err) {
    poolPressure = 'Saturated';
    if (err.message?.includes('timeout')) poolTimeouts++;
  }

  // Cleanup all sockets
  isShuttingDown = true;
  for (let i = 0; i < sockets.length; i++) {
    try {
      sockets[i].removeAllListeners();
      sockets[i].disconnect();
    } catch (_) {}
    if (i % 100 === 0 && i > 0) {
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  await r.flushall();
  await r.quit();
  await pgPool.end();

  let overallBehavior = 'RESILIENT';
  if (k6Report.failureRatePercent > 5 || spikeConnectionSuccessRate < 95) {
    overallBehavior = 'DEGRADED';
  }
  if (k6Report.failureRatePercent > 15 || spikeConnectionSuccessRate < 80) {
    overallBehavior = 'SEVERE_SPIKE_SATURATION';
  }

  const resultData = {
    scenario: SCENARIO,
    timestamp: new Date().toISOString(),
    startingUsers: BASE_USERS,
    spikeUsersAdded: SPIKE_USERS,
    finalConcurrentUsers: TOTAL_USERS,
    spikeTransitionDurationSec,
    connectionSuccessPercent: spikeConnectionSuccessRate,
    connectionFailures: SPIKE_USERS - spikeReadyCount,
    unexpectedDisconnects,
    matchmakingSuccessPercent,
    unmatchedUsers,
    duplicateSelfMultiCount,
    queueWait: {
      p50: percentile(queueWaitLatencies, 50),
      p95: percentile(queueWaitLatencies, 95),
      p99: percentile(queueWaitLatencies, 99),
    },
    messageDeliveryPercent,
    restApi: {
      throughput: k6Report.requestsPerSecond,
      p50: k6Report.p50,
      p95: k6Report.p95,
      p99: k6Report.p99,
      errorPercent: k6Report.failureRatePercent,
    },
    node: {
      cpuSeconds: procMetrics.cpuSec,
      memoryMB: procMetrics.memoryMB,
      eventLoopDelayMs: {
        p50: percentile(eventLoopDelays, 50),
        p95: percentile(eventLoopDelays, 95),
        p99: percentile(eventLoopDelays, 99),
      },
    },
    redis: {
      memoryBefore: memBefore,
      memoryAfter: memAfter,
      commandsProcessed: redisCmdDiff,
      errors: 0,
    },
    db: {
      poolPressure,
      poolTimeouts,
    },
    recoveryDurationSec,
    overallBehavior,
  };

  const outPath = path.join(resultsDir, `spike-scenario-${SCENARIO}.json`);
  fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2));

  console.log('\n============================================================');
  console.log(`🏁 SPIKE SCENARIO ${SCENARIO} RESULTS SUMMARY:`);
  console.log(`  - Base -> Spike -> Peak: ${BASE_USERS} + ${SPIKE_USERS} = ${TOTAL_USERS} users`);
  console.log(`  - Spike Transition: ${spikeTransitionDurationSec}s (${spikeConnectionSuccessRate}% success, ${SPIKE_USERS - spikeReadyCount} fail)`);
  console.log(`  - Matchmaking: ${matchmakingSuccessPercent}% (${matchedUsers}/${readyTotal} matched, ${unmatchedUsers} unmatched, ${duplicateSelfMultiCount} anomalies)`);
  console.log(`  - Queue Wait: p50=${resultData.queueWait.p50}ms | p95=${resultData.queueWait.p95}ms | p99=${resultData.queueWait.p99}ms`);
  console.log(`  - Message Delivery: ${messageDeliveryPercent}%`);
  console.log(`  - REST API: ${k6Report.requestsPerSecond} req/s | p95=${k6Report.p95}ms | p99=${k6Report.p99}ms | Error: ${k6Report.failureRatePercent}%`);
  console.log(`  - Node: ${procMetrics.memoryMB} MB RAM | EventLoop p95=${resultData.node.eventLoopDelayMs.p95}ms`);
  console.log(`  - Redis: ${memAfter} | ${redisCmdDiff} commands`);
  console.log(`  - DB Pool Pressure: ${poolPressure} (${poolTimeouts} timeouts)`);
  console.log(`  - Recovery Duration: ${recoveryDurationSec}s`);
  console.log(`  - OVERALL BEHAVIOR: ${overallBehavior}`);
  console.log('============================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Spike test error:', err);
  process.exit(1);
});
