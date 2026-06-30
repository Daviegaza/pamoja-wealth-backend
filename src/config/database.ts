import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "./logger.js";
import { config } from "./index.js";

const adapter = new PrismaPg({ connectionString: config.database.url });

export const prisma = new PrismaClient({
  adapter,
  log: [
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" },
  ],
});

prisma.$on("warn", (e: unknown) => logger.warn(e));
prisma.$on("error", (e: unknown) => logger.error(e));
