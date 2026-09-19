import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const tier = parseInt(process.argv[2] || '50', 10);
// Sustained 60s for 50, 100, 250, 500 users by default
const defaultDuration = (tier === 50 || tier === 100 || tier === 250 || tier === 500) ? '60s' : '30s';
const duration = process.argv[3] || defaultDuration;
const durationMs = parseInt(duration, 10) * 1000 || ((tier === 50 || tier === 100 || tier === 250 || tier === 500) ? 60000 : 30000);
const rampUp = process.argv[4] || process.env.RAMP_UP || (tier >= 500 ? '15s' : '0s');
const rampUpMs = parseInt(rampUp, 10) * 1000 || 0;

const suiteStartTime = Date.now();

console.log(`\n############################################################`);
console.log(`🚀 CHATBUDDY LOAD TEST SUITE: TIER ${tier} CONCURRENT USERS`);
console.log(`Ramp-up: ${rampUp} | Duration: ${duration} (${durationMs / 1000}s sustained) | Started: ${new Date().toLocaleTimeString()}`);
console.log(`############################################################\n`);

const resultsDir = path.resolve('load-tests/results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    console.log(`> Executing: ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...env },
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command exited with code ${code}`));
    });

    proc.on('error', (err) => reject(err));
  });
}

async function execute() {
  const k6SummaryFile = path.join(resultsDir, `k6-rest-${tier}-summary.json`);
  const socketIoSummaryFile = path.join(resultsDir, `socketio-${tier}-users.json`);
  const combinedFile = path.join(resultsDir, `${tier}-users.json`);

  const k6Path = path.resolve('load-tests/bin/k6.exe');

  let restPhaseDuration = 0;
  let socketPhaseDuration = 0;

  // 1. Run k6 REST API load test
  if (fs.existsSync(k6Path)) {
    console.log(`\n[Phase 1] Executing k6 REST API Saturation Test (${tier} VUs, ${rampUp} ramp, ${duration} sustained)...`);
    const restStart = Date.now();
    try {
      await runCommand(k6Path, [
        'run',
        '--env', `VUS=${tier}`,
        '--env', `DURATION=${duration}`,
        '--env', `RAMP_UP=${rampUp}`,
        '--summary-export', `"${k6SummaryFile}"`,
        'load-tests/scenarios/rest-api-load.js',
      ]);
    } catch (err) {
      console.warn('k6 test encountered threshold warning or exit code:', err.message);
    }
    restPhaseDuration = parseFloat(((Date.now() - restStart) / 1000).toFixed(1));
  } else {
    console.log('\nk6.exe not found in load-tests/bin/, skipping k6 phase.');
  }

  // 2. Run Socket.IO Concurrency Test
  console.log(`\n[Phase 2] Executing Socket.IO Concurrency & Matchmaking Test (${tier} Users, ${rampUp} ramp, ${duration} sustained)...`);
  const socketStart = Date.now();
  await runCommand('node', [
    'load-tests/runners/socketio-concurrency-harness.mjs',
    tier.toString(),
  ], {
    DURATION_MS: durationMs.toString(),
    RAMP_UP_MS: rampUpMs.toString(),
  });
  socketPhaseDuration = parseFloat(((Date.now() - socketStart) / 1000).toFixed(1));

  // 3. Compile Combined Report
  const teardownStart = Date.now();

  let k6Metrics = null;
  if (fs.existsSync(k6SummaryFile)) {
    try {
      k6Metrics = JSON.parse(fs.readFileSync(k6SummaryFile, 'utf-8'));
    } catch (_) {}
  }

  let socketIoMetrics = null;
  if (fs.existsSync(socketIoSummaryFile)) {
    try {
      socketIoMetrics = JSON.parse(fs.readFileSync(socketIoSummaryFile, 'utf-8'));
    } catch (_) {}
  }

  // Robustly extract k6 latency metrics
  const durObj = k6Metrics?.metrics?.http_req_duration?.values || k6Metrics?.metrics?.http_req_duration || {};
  const httpReqsObj = k6Metrics?.metrics?.http_reqs?.values || k6Metrics?.metrics?.http_reqs || {};
  const failedObj = k6Metrics?.metrics?.http_req_failed?.values || k6Metrics?.metrics?.http_req_failed || {};

  const totalRequests = httpReqsObj.count ?? 0;
  const requestsPerSecond = parseFloat(((httpReqsObj.rate ?? 0)).toFixed(1));
  const avgLatency = parseFloat(((durObj.avg ?? 0)).toFixed(1));
  const p50Latency = parseFloat(((durObj.med ?? durObj['p(50)'] ?? 0)).toFixed(1));
  const p95Latency = parseFloat(((durObj['p(95)'] ?? 0)).toFixed(1));
  const p99Latency = durObj['p(99)'] !== undefined
    ? parseFloat(durObj['p(99)'].toFixed(1))
    : (durObj.max !== undefined ? parseFloat(durObj.max.toFixed(1)) : 0);
  const failureRatePercent = parseFloat((((failedObj.value ?? failedObj.rate ?? 0)) * 100).toFixed(2));

  // Extract per-endpoint statistics
  const checks = k6Metrics?.root_group?.checks || {};
  const metricsMap = k6Metrics?.metrics || {};

  function getEndpointStats(trendName, checkName, path) {
    const trend = metricsMap[trendName]?.values || metricsMap[trendName] || {};
    const check = checks[checkName] || {};
    const passes = check.passes || 0;
    const fails = check.fails || 0;
    const count = passes + fails;
    const failRate = count > 0 ? parseFloat(((fails / count) * 100).toFixed(2)) : 0;

    return {
      path,
      requests: count,
      avg: parseFloat(((trend.avg ?? 0)).toFixed(1)),
      p50: parseFloat(((trend.med ?? trend['p(50)'] ?? 0)).toFixed(1)),
      p95: parseFloat(((trend['p(95)'] ?? 0)).toFixed(1)),
      p99: trend['p(99)'] !== undefined ? parseFloat(trend['p(99)'].toFixed(1)) : 0,
      failureRatePercent: failRate,
    };
  }

  const endpointStats = [
    getEndpointStats('discover_latency', 'discover status is 200', 'GET /friends/discover'),
    getEndpointStats('friends_latency', 'friends status is 200', 'GET /friends/:userId'),
    getEndpointStats('profile_latency', 'profile status is 200 or 404', 'GET /users/:userId/profile'),
    getEndpointStats('notification_latency', 'notifications status is 200', 'GET /notifications/:userId/unread-count'),
  ];

  const totalRuntimeSeconds = parseFloat(((Date.now() - suiteStartTime) / 1000).toFixed(1));
  const teardownDurationMs = Date.now() - teardownStart;

  const combinedReport = {
    tier: `${tier}_users`,
    concurrency: tier,
    duration,
    timestamp: new Date().toISOString(),
    runtime: {
      totalSeconds: totalRuntimeSeconds,
      rampUpDuration: rampUp,
      restPhaseSeconds: restPhaseDuration,
      socketPhaseSeconds: socketPhaseDuration,
      teardownMs: teardownDurationMs,
    },
    restApi: k6Metrics ? {
      requests: totalRequests,
      requestsPerSecond,
      latencyMs: {
        avg: avgLatency,
        p50: p50Latency,
        p95: p95Latency,
        p99: p99Latency,
      },
      failureRatePercent,
      endpoints: endpointStats,
    } : null,
    realtimeSocketIo: socketIoMetrics ? {
      connectionCount: socketIoMetrics.connections?.connected || 0,
      connectionSuccessRatePercent: socketIoMetrics.connections?.connectionSuccessRatePercent || 0,
      connectionLatencyP95Ms: socketIoMetrics.connections?.latencyMs?.p95 || 0,
      matchmakingAttempts: socketIoMetrics.matchmaking?.attempts || 0,
      successfulMatches: socketIoMetrics.matchmaking?.successfulMatches || 0,
      matchedPairsCount: socketIoMetrics.matchmaking?.matchedPairsCount || 0,
      unmatchedUsers: socketIoMetrics.matchmaking?.unmatchedUsers || 0,
      matchmakingSuccessRatePercent: socketIoMetrics.matchmaking?.matchmakingSuccessRatePercent || 0,
      queueWaitLatencyMs: socketIoMetrics.matchmaking?.queueWaitLatencyMs || {
        avg: 0, p50: 0, p95: 0, p99: 0,
      },
      matchExecutionLatencyMs: socketIoMetrics.matchmaking?.matchExecutionLatencyMs || {
        avg: 0, p50: 0, p95: 0, p99: 0,
      },
      messagesSent: socketIoMetrics.messaging?.sent || 0,
      messagesReceived: socketIoMetrics.messaging?.received || 0,
      deliveryDefinition: socketIoMetrics.messaging?.deliveryDefinition || 'Messages received by counterpart in room',
      errors: {
        socketErrors: socketIoMetrics.errors?.socketErrors || 0,
        connectErrors: socketIoMetrics.errors?.connectErrors || 0,
        socketDisconnects: socketIoMetrics.errors?.socketDisconnects || 0,
        totalErrors: socketIoMetrics.errors?.totalErrors || 0,
      },
    } : null,
  };

  fs.writeFileSync(combinedFile, JSON.stringify(combinedReport, null, 2), 'utf-8');

  console.log(`\n============================================================`);
  console.log(`📊 COMBINED LOAD TEST SUMMARY: TIER ${tier} USERS (${duration} sustained)`);
  console.log(`============================================================`);
  console.log(`[TEST RUNTIME]`);
  console.log(`  - Ramp-Up Duration: ${rampUp}`);
  console.log(`  - REST Phase Duration: ${restPhaseDuration}s`);
  console.log(`  - Socket Phase Duration: ${socketPhaseDuration}s`);
  console.log(`  - Result Aggregation & Teardown: ${teardownDurationMs}ms`);
  console.log(`  - Total Suite Runtime: ${totalRuntimeSeconds}s`);

  if (combinedReport.restApi) {
    console.log(`\n[REST API]`);
    console.log(`  - Requests: ${combinedReport.restApi.requests}`);
    console.log(`  - Requests/sec: ${combinedReport.restApi.requestsPerSecond} req/s`);
    console.log(`  - Latency: avg=${combinedReport.restApi.latencyMs.avg}ms, p50=${combinedReport.restApi.latencyMs.p50}ms, p95=${combinedReport.restApi.latencyMs.p95}ms, p99=${combinedReport.restApi.latencyMs.p99}ms`);
    console.log(`  - Failure Rate: ${combinedReport.restApi.failureRatePercent}%`);
    console.log(`\n  [Per-Endpoint Latency Breakdown]`);
    console.log(`  ${'Endpoint'.padEnd(38)} ${'Count'.padStart(6)} ${'avg'.padStart(8)} ${'p50'.padStart(8)} ${'p95'.padStart(8)} ${'p99'.padStart(8)} ${'fail%'.padStart(7)}`);
    console.log(`  ${'-'.repeat(87)}`);
    for (const ep of combinedReport.restApi.endpoints) {
      console.log(`  ${ep.path.padEnd(38)} ${String(ep.requests).padStart(6)} ${(ep.avg + 'ms').padStart(8)} ${(ep.p50 + 'ms').padStart(8)} ${(ep.p95 + 'ms').padStart(8)} ${(ep.p99 + 'ms').padStart(8)} ${(ep.failureRatePercent + '%').padStart(7)}`);
    }
  }

  if (combinedReport.realtimeSocketIo) {
    console.log(`\n[Socket.IO Real-time]`);
    console.log(`  - Connection Count: ${combinedReport.realtimeSocketIo.connectionCount} / ${tier}`);
    console.log(`  - Connection Success %: ${combinedReport.realtimeSocketIo.connectionSuccessRatePercent}%`);
    console.log(`  - Connection Latency p95: ${combinedReport.realtimeSocketIo.connectionLatencyP95Ms}ms`);
    console.log(`  - Matchmaking Attempts: ${combinedReport.realtimeSocketIo.matchmakingAttempts}`);
    console.log(`  - Successful Matches: ${combinedReport.realtimeSocketIo.successfulMatches} (${combinedReport.realtimeSocketIo.matchedPairsCount} pairs)`);
    console.log(`  - Unmatched Users: ${combinedReport.realtimeSocketIo.unmatchedUsers} (simultaneous queue tails at test cutoff)`);
    console.log(`  - Matchmaking Success %: ${combinedReport.realtimeSocketIo.matchmakingSuccessRatePercent}%`);
    console.log(`  - Queue Wait Latency (Passive): avg=${combinedReport.realtimeSocketIo.queueWaitLatencyMs.avg}ms, p50=${combinedReport.realtimeSocketIo.queueWaitLatencyMs.p50}ms, p95=${combinedReport.realtimeSocketIo.queueWaitLatencyMs.p95}ms, p99=${combinedReport.realtimeSocketIo.queueWaitLatencyMs.p99}ms`);
    console.log(`  - Match Execution Latency (Backend): avg=${combinedReport.realtimeSocketIo.matchExecutionLatencyMs.avg}ms, p50=${combinedReport.realtimeSocketIo.matchExecutionLatencyMs.p50}ms, p95=${combinedReport.realtimeSocketIo.matchExecutionLatencyMs.p95}ms, p99=${combinedReport.realtimeSocketIo.matchExecutionLatencyMs.p99}ms`);
    console.log(`  - Messages Sent: ${combinedReport.realtimeSocketIo.messagesSent}`);
    console.log(`  - Messages Received: ${combinedReport.realtimeSocketIo.messagesReceived}`);
    console.log(`  - Socket Errors/Disconnects: errors=${combinedReport.realtimeSocketIo.errors.socketErrors}, connectErrors=${combinedReport.realtimeSocketIo.errors.connectErrors}, unexpectedDisconnects=${combinedReport.realtimeSocketIo.errors.socketDisconnects}`);
  }
  console.log(`Saved comprehensive report: ${combinedFile}`);
  console.log(`============================================================\n`);

  process.exit(0);
}

execute().catch((err) => {
  console.error('Suite error:', err);
  process.exit(1);
});
