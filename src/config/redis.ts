import Redis from "ioredis";
import { config } from "./index.js";
import { logger } from "./logger.js";

export const redis = new (Redis as any)(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 10) return null;
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err: Error) => logger.error({ err }, "Redis error"));
