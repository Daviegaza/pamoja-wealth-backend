import pino from "pino";
import { config } from "./index.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.nodeEnv === "production" ? "info" : config.nodeEnv === "test" ? "silent" : "debug"),
  ...(config.nodeEnv === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
