import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
const errorRate = new Rate('api_error_rate');
const discoverLatency = new Trend('discover_latency');
const profileLatency = new Trend('profile_latency');
const notificationLatency = new Trend('notification_latency');
const friendsLatency = new Trend('friends_latency');
const totalRequests = new Counter('total_api_requests');

// Configurable load parameters via __ENV
const targetVUs = parseInt(__ENV.VUS || '50', 10);
const testDuration = __ENV.DURATION || '30s';
const rampUp = __ENV.RAMP_UP || '0s';
const rampUpSeconds = parseInt(rampUp, 10) || 0;
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export const options = {
  ...(rampUpSeconds > 0
    ? {
        stages: [
          { duration: `${rampUpSeconds}s`, target: targetVUs },
          { duration: testDuration, target: targetVUs },
        ],
      }
    : {
        vus: targetVUs,
        duration: testDuration,
      }),
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_failed: ['rate<0.05'], // failure rate < 5%
    http_req_duration: ['p(95)<3000'], // 95% of requests below 3s against remote DB in Singapore
    api_error_rate: ['rate<0.05'],
  },
};

const SAMPLE_USER_IDS = [
  '4dcfd5da-b4be-4d87-90eb-59efa300321d',
  '7b897103-68d7-4638-89c5-8fa011aeb2c3',
  'd4e73b22-8356-4aa8-9f17-8e658ec3f890',
  'e2908f9a-8451-4654-8c81-817887fa541d',
  'f7391741-1122-4948-a070-5cb28766158d',
];

const SEARCH_QUERIES = ['', 'raja', 'rahul', 'alex', 'john', 'verve', 'user'];
const GENDER_FILTERS = ['any', 'male', 'female'];

export default function () {
  const vuId = __VU;
  const iteration = __ITER;
  const randomUserId = SAMPLE_USER_IDS[vuId % SAMPLE_USER_IDS.length] || `load-user-${vuId}`;

  const dice = Math.random();

  const clientIp = `192.168.${Math.floor(vuId / 250)}.${(vuId % 250) + 1}`;
  const baseHeaders = { 'X-Forwarded-For': clientIp };

  if (dice < 0.40) {
    // 1. Discover People Search (Search query + filters)
    const q = SEARCH_QUERIES[iteration % SEARCH_QUERIES.length];
    const gender = GENDER_FILTERS[iteration % GENDER_FILTERS.length];
    const onlineOnly = iteration % 2 === 0;

    const url = `${BASE_URL}/friends/discover?userId=${randomUserId}&q=${encodeURIComponent(q)}&gender=${gender}&onlineOnly=${onlineOnly}&limit=20`;
    const res = http.get(url, { headers: baseHeaders, tags: { name: 'GET /friends/discover' } });

    totalRequests.add(1);
    discoverLatency.add(res.timings.duration);

    const success = check(res, {
      'discover status is 200': (r) => r.status === 200,
      'discover returns json array': (r) => {
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch (_) {
          return false;
        }
      },
    });

    errorRate.add(!success);
  } else if (dice < 0.65) {
    // 2. User Profile Fetch
    const url = `${BASE_URL}/users/${randomUserId}/profile`;
    const res = http.get(url, {
      headers: baseHeaders,
      tags: { name: 'GET /users/:id/profile' },
      responseCallback: http.expectedStatuses(200, 404),
    });

    totalRequests.add(1);
    profileLatency.add(res.timings.duration);

    const success = check(res, {
      'profile status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    errorRate.add(!success);
  } else if (dice < 0.85) {
    // 3. Notification Count & Polling
    const url = `${BASE_URL}/notifications/${randomUserId}/unread-count`;
    const res = http.get(url, { headers: baseHeaders, tags: { name: 'GET /notifications/:id/unread-count' } });

    totalRequests.add(1);
    notificationLatency.add(res.timings.duration);

    const success = check(res, {
      'notifications status is 200': (r) => r.status === 200,
    });

    errorRate.add(!success);
  } else {
    // 4. Friends List Fetch
    const url = `${BASE_URL}/friends/${randomUserId}`;
    const res = http.get(url, { headers: baseHeaders, tags: { name: 'GET /friends/:id' } });

    totalRequests.add(1);
    friendsLatency.add(res.timings.duration);

    const success = check(res, {
      'friends status is 200': (r) => r.status === 200,
    });

    errorRate.add(!success);
  }

  // Realistic user pacing between actions (0.8s - 1.6s think time)
  sleep(Math.random() * 0.8 + 0.8);
}
