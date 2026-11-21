import http from "http";
import app from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/database.js";
import { redis } from "./config/redis.js";
import { initSentry } from "./config/sentry.js";

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "unhandledRejection");
});

async function main() {
  await initSentry();

  try {
    await prisma.$connect();
    logger.info("PostgreSQL connected");
  } catch (err) {
    logger.error({ err }, "Failed to connect to PostgreSQL");
    process.exit(1);
  }

  try {
    // The Redis-backed rate limiter issues a command at import time, which
    // auto-starts the lazy connection; only call connect() if nothing has.
    if (redis.status === "wait") {
      await redis.connect();
    } else if (redis.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Redis not ready within 10s")), 10_000);
        redis.once("ready", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    logger.info("Redis connected");
  } catch (err) {
    // Redis backs refresh tokens, OTPs, login lockout and rate limits.
    if (config.isProduction) {
      logger.error({ err }, "Redis is required in production");
      process.exit(1);
    }
    logger.warn({ err }, "Redis not available — auth refresh/OTP will fail until it is");
  }

  const server = http.createServer(app);
  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, "Pamoja Wealth API started");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    server.close(() => {
      void Promise.allSettled([prisma.$disconnect(), redis.quit()]).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
