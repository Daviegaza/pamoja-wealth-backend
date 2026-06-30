import pino from "pino";
import { config } from "./index.js";

export const logger = pino({
  level: config.nodeEnv === "production" ? "info" : "debug",
  ...(config.nodeEnv === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
