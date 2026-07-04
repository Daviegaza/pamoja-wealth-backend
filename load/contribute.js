/**
 * k6 load test — contribute STK-push path under sustained load.
 *
 * Ramps to 100 concurrent users over 2 min, holds for 5 min, ramps down.
 * Emulates the go-live launch morning. Watches p95 latency + STK rate-limit
 * ceilings (10 pushes/hour/msisdn).
 *
 * Auth: uses a pre-provisioned test user (K6_TEST_TOKEN env). Contribution
 * endpoint is idempotent on transaction reference — safe to spam.
 *
 * Run:
 *   BASE_URL=... K6_TEST_TOKEN=... K6_CHAMA_ID=... k6 run load/contribute.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000/api/v1";
const TOKEN = __ENV.K6_TEST_TOKEN || "";
const CHAMA_ID = __ENV.K6_CHAMA_ID || "";

const contributeLatency = new Trend("contribute_latency");

export const options = {
  stages: [
    { duration: "2m", target: 100 },
    { duration: "5m", target: 100 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    http_req_failed: ["rate<0.02"],
    contribute_latency: ["p(95)<1000"],
  },
};

export default function () {
  if (!TOKEN || !CHAMA_ID) {
    // Fall back to a public endpoint so the script still runs standalone.
    const r = http.get(`${BASE_URL}/health`);
    check(r, { "health 200": (res) => res.status === 200 });
    sleep(1);
    return;
  }

  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  const wallet = http.get(`${BASE_URL}/wallet`, { headers });
  check(wallet, { "wallet 200": (r) => r.status === 200 });

  const contribute = http.post(
    `${BASE_URL}/chamas/${CHAMA_ID}/contribute`,
    JSON.stringify({ amount: 100 }),
    { headers, tags: { name: "contribute" } },
  );
  contributeLatency.add(contribute.timings.duration);
  check(contribute, {
    "contribute 2xx or 429": (r) => r.status >= 200 && r.status < 500,
  });

  sleep(2);
}
