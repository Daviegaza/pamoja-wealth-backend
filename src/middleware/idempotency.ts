import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";

/**
 * Idempotency middleware (Stripe-style).
 *
 * Behaviour per https://stripe.com/docs/api/idempotent_requests:
 *   - Applies ONLY to mutating verbs (POST / PUT / PATCH / DELETE).
 *   - Client sends `Idempotency-Key` header (UUID / opaque token, <=255 chars).
 *   - Server stores `{status, body, bodyHash}` in Redis for 24h keyed by
 *     `idempotency:{userId}:{key}`.
 *   - Replay (same key + same body hash) → return cached response, short-circuit.
 *   - Conflict (same key + different body hash) → 422 idempotency-key-conflict.
 *   - First time (key absent) → run handler, capture `res.json` body, then
 *     `SET NX EX 86400`. The NX guard prevents two near-simultaneous requests
 *     from both populating the cache.
 *
 * Anonymous callers (no `req.user`) are scoped to "anon" — fine for public
 * donation endpoints because the key itself is the unique secret.
 *
 * Usage:
 *   router.post("/wallet/deposit", authenticate, idempotency(), validate(...), handler);
 */

const TTL_SECONDS = 86_400; // 24h per Stripe spec
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_KEY_LENGTH = 255;

interface CachedResponse {
  status: number;
  body: unknown;
  bodyHash: string;
}

function hashBody(body: unknown): string {
  // Deterministic hash: JSON-stringify with sorted keys.
  // Empty body → "0" so an empty POST still gets a stable hash.
  const stable = body === undefined || body === null
    ? ""
    : JSON.stringify(body, Object.keys(body as object).sort());
  return crypto.createHash("sha256").update(stable).digest("hex");
}

function ownerScope(req: Request): string {
  return req.user?.userId ?? "anon";
}

export function idempotency() {
  return async function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Per Stripe spec — only mutating verbs are eligible.
    if (!MUTATING_METHODS.has(req.method)) {
      return next();
    }

    const rawKey = req.header("Idempotency-Key") ?? req.header("idempotency-key");
    if (!rawKey) {
      // Header required for opted-in routes — caller is responsible for
      // wiring this middleware only where they want it enforced.
      res.status(400).json({ error: "missing-idempotency-key" });
      return;
    }

    const key = rawKey.trim();
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      res.status(400).json({ error: "invalid-idempotency-key" });
      return;
    }

    const cacheKey = `idempotency:${ownerScope(req)}:${key}`;
    const bodyHash = hashBody(req.body);

    let existing: string | null = null;
    try {
      existing = await redis.get(cacheKey);
    } catch (err) {
      logger.warn({ err, cacheKey }, "idempotency: redis lookup failed, proceeding without cache");
    }

    if (existing) {
      let parsed: CachedResponse | null = null;
      try {
        parsed = JSON.parse(existing) as CachedResponse;
      } catch {
        parsed = null;
      }

      if (parsed) {
        if (parsed.bodyHash !== bodyHash) {
          // Same key, different body — Stripe returns 422.
          res.status(422).json({ error: "idempotency-key-conflict" });
          return;
        }
        // Replay the cached response.
        res.status(parsed.status).json(parsed.body);
        return;
      }
      // Corrupted cache entry — fall through and re-process.
    }

    // First time. Wrap res.json so we can capture the response body, then
    // persist with SET NX EX so concurrent duplicates collide cleanly.
    const originalJson = res.json.bind(res);
    let captured = false;

    res.json = ((body: unknown) => {
      if (!captured) {
        captured = true;
        const payload: CachedResponse = {
          status: res.statusCode,
          body,
          bodyHash,
        };
        // Fire-and-forget — never block the response on cache write.
        // Only cache successful + client-error responses (2xx/4xx); skip 5xx
        // so a transient failure can be retried with the same key.
        if (res.statusCode < 500) {
          redis
            .set(cacheKey, JSON.stringify(payload), "EX", TTL_SECONDS, "NX")
            .catch((err: unknown) => {
              logger.warn({ err, cacheKey }, "idempotency: redis store failed");
            });
        }
      }
      return originalJson(body);
    }) as Response["json"];

    next();
  };
}
