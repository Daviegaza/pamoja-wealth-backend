import Redis from "ioredis";
import { config } from "./index.js";
import { logger } from "./logger.js";

// BullMQ REQUIRES `maxRetriesPerRequest: null` — with the default (3), any
// hiccup throws MaxRetriesPerRequestError which crashes the whole process
// through unhandled rejection. See ioredis docs + BullMQ recommendations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const redis = new (Redis as any)(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times: number) {
    // Cap backoff at 2s; keep reconnecting forever so a temporarily-down
    // Redis recovers cleanly instead of taking the whole API with it.
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
  reconnectOnError(err: Error): boolean {
    // Reconnect on transient errors that used to bubble as fatal.
    return err.message.includes("READONLY") || err.message.includes("ECONNRESET");
  },
});

redis.on("connect", () => logger.info("Redis connected"));
// Swallow Redis errors — they used to bubble to unhandledRejection and kill
// the process. We log once every 30s to avoid spam, and workers/queries
// naturally retry via the strategy above.
let lastRedisErrorAt = 0;
redis.on("error", (err: Error) => {
  const now = Date.now();
  if (now - lastRedisErrorAt < 30_000) return;
  lastRedisErrorAt = now;
  logger.warn({ err: err.message, url: config.redis.url }, "Redis error (throttled)");
});
