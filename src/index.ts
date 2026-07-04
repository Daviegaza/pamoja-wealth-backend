import http from "http";
import app from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/database.js";
import { redis } from "./config/redis.js";
import { initWebSocket } from "./websocket/index.js";
import { initSentry } from "./config/sentry.js";

// Global crash guards — Redis / socket / worker errors used to bubble up
// as unhandledRejection and take the process down. Log + continue.
process.on("unhandledRejection", (err) => {
  logger.warn({ err }, "unhandledRejection (ignored — process continues)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException (ignored — process continues)");
});

async function main() {
  await initSentry();

  // Connect to database
  try {
    await prisma.$connect();
    logger.info("PostgreSQL connected");
  } catch (err) {
    logger.error({ err }, "Failed to connect to PostgreSQL");
    process.exit(1);
  }

  // Connect to Redis
  try {
    await redis.connect();
    logger.info("Redis connected");
  } catch (err) {
    logger.warn({ err }, "Redis not available — some features disabled");
  }

  // Create HTTP server
  const server = http.createServer(app);

  // Initialize WebSocket
  try {
    initWebSocket(server);
  } catch (err) {
    logger.warn({ err }, "WebSocket initialization failed");
  }

  // Initialize background workers (only in production or when explicitly enabled)
  if (config.nodeEnv === "production") {
    try {
      await import("./jobs/workers/index.js");
      await import("./jobs/scheduler.js").then((m) => m.startScheduler());
      logger.info("Background workers started");
    } catch (err) {
      logger.warn({ err }, "Background workers failed to start");
    }
  }

  // Start listening
  server.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.nodeEnv,
        api: `http://localhost:${config.port}/api/v1`,
        ws: `ws://localhost:${config.port}/ws`,
      },
      "Pamoja Wealth backend started"
    );
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    server.close(async () => {
      await prisma.$disconnect();
      await redis.quit();
      logger.info("Shutdown complete");
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
