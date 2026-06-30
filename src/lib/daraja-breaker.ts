import CircuitBreaker from "opossum";
import { logger } from "../config/logger.js";

/**
 * Circuit breaker for Safaricom Daraja calls.
 *
 * Background: Daraja has documented production outages (Jan/Jun/Aug/Sep 2024,
 * Mar 2025, Sep 2025 Fintech 2.0 cutover). Without a breaker, M-Pesa downtime
 * exhausts the Node event loop because every queued contribution/payout job
 * piles up on a hung HTTPS socket.
 *
 * Defaults are tuned for Daraja's published flakiness:
 *   - timeout: 30s       — Safaricom's own SLA for callbacks; STK Push usually
 *                          settles in <10s but token / B2C have wandered to 20s+.
 *   - errorThresholdPercentage: 50 — trip when half the recent calls fail.
 *   - resetTimeout: 10s  — try a single probe call after 10s in OPEN.
 *   - volumeThreshold: 10 — never trip until at least 10 calls have been seen
 *                           in the rolling window (don't blow up on cold starts).
 *
 * Usage:
 *   import { fire } from "../lib/daraja-breaker.js";
 *   const token = await fire(getAccessToken);                  // no args
 *   const stk = await fire(stkPush, phone, amount, accountRef); // with args
 *
 * Example wrapping a Daraja call inside `src/services/mpesa.service.ts`:
 *   // const token = await fire(getAccessToken); // <- wrap every Daraja call
 *
 * Each wrapped function gets its OWN breaker instance, cached by reference,
 * so per-endpoint failure rates are tracked independently — a B2C outage
 * doesn't trip the STK Push circuit.
 */

export interface DarajaBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

const DEFAULTS: Required<DarajaBreakerOptions> = {
  timeout: 30_000,
  errorThresholdPercentage: 50,
  resetTimeout: 10_000,
  volumeThreshold: 10,
};

// Cache breakers per wrapped function so listeners / stats aren't re-created.
const breakerCache = new WeakMap<Function, CircuitBreaker>();

function getOrCreateBreaker<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  opts: DarajaBreakerOptions,
): CircuitBreaker<TArgs, TResult> {
  const cached = breakerCache.get(fn);
  if (cached) return cached as CircuitBreaker<TArgs, TResult>;

  const settings = { ...DEFAULTS, ...opts };
  const name = fn.name || "anonymousDarajaCall";

  const breaker = new CircuitBreaker<TArgs, TResult>(fn, {
    name,
    timeout: settings.timeout,
    errorThresholdPercentage: settings.errorThresholdPercentage,
    resetTimeout: settings.resetTimeout,
    volumeThreshold: settings.volumeThreshold,
  });

  breaker.on("open", () => {
    logger.warn(
      { fn: name, resetTimeout: settings.resetTimeout },
      "daraja-breaker: OPEN — Daraja calls short-circuited",
    );
  });

  breaker.on("halfOpen", () => {
    logger.warn({ fn: name }, "daraja-breaker: HALF-OPEN — probing Daraja");
  });

  breaker.on("close", () => {
    logger.warn({ fn: name }, "daraja-breaker: CLOSED — Daraja calls resumed");
  });

  breaker.on("timeout", () => {
    logger.warn({ fn: name, timeoutMs: settings.timeout }, "daraja-breaker: call timed out");
  });

  breaker.on("reject", () => {
    logger.warn({ fn: name }, "daraja-breaker: call rejected (circuit OPEN)");
  });

  breaker.on("failure", (err: Error) => {
    logger.warn({ fn: name, err: err?.message }, "daraja-breaker: call failed");
  });

  breakerCache.set(fn, breaker);
  return breaker;
}

/**
 * Fire a Daraja call through the circuit breaker. The function is identified
 * by reference, so the SAME `fn` always lands on the SAME breaker.
 */
export function fire<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  ...args: TArgs
): Promise<TResult> {
  const breaker = getOrCreateBreaker(fn, {});
  return breaker.fire(...args) as Promise<TResult>;
}

/**
 * Same as `fire`, but lets the caller override the per-breaker settings the
 * FIRST time `fn` is wrapped. Useful when a specific Daraja endpoint needs a
 * tighter timeout (e.g. token refresh).
 */
export function fireWith<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  opts: DarajaBreakerOptions,
  ...args: TArgs
): Promise<TResult> {
  const breaker = getOrCreateBreaker(fn, opts);
  return breaker.fire(...args) as Promise<TResult>;
}

/**
 * Surface raw breaker stats (open / closed state, success / failure counts).
 * Handy for /health endpoints — do NOT call this in a hot path.
 */
export function statsFor<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): { state: "open" | "halfOpen" | "closed"; stats: CircuitBreaker.Stats } | null {
  const breaker = breakerCache.get(fn) as CircuitBreaker<TArgs, TResult> | undefined;
  if (!breaker) return null;
  const state: "open" | "halfOpen" | "closed" = breaker.opened
    ? "open"
    : breaker.halfOpen
      ? "halfOpen"
      : "closed";
  return { state, stats: breaker.stats };
}

export const breaker = { fire, fireWith, statsFor };
