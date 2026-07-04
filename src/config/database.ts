import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "./logger.js";
import { config } from "./index.js";

const adapter = new PrismaPg({
  connectionString: config.database.url,
  // Production connection pooling — prevents connection exhaustion
  ...(config.nodeEnv === "production" ? {
    poolOptions: {
      min: config.database.poolMin, // 2 minimum idle connections
      max: config.database.poolMax, // 20 max (tune based on DB server)
      idleTimeoutMillis: 30000,     // close idle after 30s
      connectionTimeoutMillis: 5000, // fail fast (5s) if DB unreachable
    },
  } : {}),
});

export const prisma = new PrismaClient({
  adapter,
  log: [
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" },
  ],
});

prisma.$on("warn", (e: unknown) => logger.warn(e));
prisma.$on("error", (e: unknown) => logger.error(e));
