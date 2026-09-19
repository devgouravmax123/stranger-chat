import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
const wsConnections = new Counter('ws_connections_total');
const wsErrors = new Rate('ws_errors_rate');
const wsHandshakeDuration = new Trend('ws_handshake_duration');
const wsMessagesReceived = new Counter('ws_messages_received');

const targetVUs = parseInt(__ENV.VUS || '50', 10);
const testDuration = __ENV.DURATION || '30s';
const WS_URL = __ENV.WS_URL || 'ws://localhost:3001/socket.io/?EIO=4&transport=websocket';

export const options = {
  vus: targetVUs,
  duration: testDuration,
  thresholds: {
    ws_errors_rate: ['rate<0.05'],
    ws_handshake_duration: ['p(95)<500'],
  },
};

export default function () {
  const vuId = __VU;
  const dummyUserId = `k6-user-${vuId}`;

  const res = ws.connect(WS_URL, {}, function (socket) {
    let handshakeComplete = false;
    const connectStartTime = Date.now();

    socket.on('open', function () {
      wsConnections.add(1);
    });

    socket.on('message', function (data) {
      wsMessagesReceived.add(1);

      // Engine.IO open packet: 0{"sid":...}
      if (data.startsWith('0')) {
        // Send Socket.IO connect packet: 40
        socket.send('40');
      }

      // Socket.IO connected: 40{"sid":...}
      if (data.startsWith('40')) {
        handshakeComplete = true;
        wsHandshakeDuration.add(Date.now() - connectStartTime);

        // Announce presence via Socket.IO event: 42["friend_online", {"userId": "..."}]
        socket.send(`42["friend_online",{"userId":"${dummyUserId}"}]`);
      }

      // Engine.IO ping packet: 2 -> respond with pong: 3
      if (data === '2') {
        socket.send('3');
      }
    });

    socket.on('error', function (e) {
      wsErrors.add(1);
    });

    socket.on('close', function () {
      if (!handshakeComplete) {
        wsErrors.add(1);
      }
    });

    // Keep connection alive for a duration
    socket.setTimeout(function () {
      socket.close();
    }, 5000);
  });

  check(res, { 'ws connected status is 101': (r) => r && r.status === 101 });
  sleep(1);
}
