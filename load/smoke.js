/**
 * k6 smoke test — 1 VU, 30s. Fast-check that the hot endpoints respond.
 *
 * Run:
 *   BASE_URL=http://localhost:3000/api/v1 k6 run load/smoke.js
 *
 * CI: gate on p95 < 500ms + zero failures.
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000/api/v1";

export const options = {
  vus: 1,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { "health 200": (r) => r.status === 200 });

  const plans = http.get(`${BASE_URL}/subscription-tiers`);
  check(plans, { "plans 200": (r) => r.status === 200 });

  const fx = http.get(`${BASE_URL}/fx/rates`);
  check(fx, { "fx 200": (r) => r.status === 200 });

  sleep(1);
}
