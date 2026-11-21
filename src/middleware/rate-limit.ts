import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/api-error.js";
import { config } from "../config/index.js";

// Each limiter needs its own Redis key prefix; with the shared default
// ("rl:") every request counted against the 5/min auth budget too.
function createLimiter(name: string, windowMs: number, max: number, message: string) {
  return rateLimit({
    store: new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Integration tests exercise auth flows repeatedly from one IP.
    skip: () => config.nodeEnv === "test",
    handler: (_req, _res) => {
      throw ApiError.rateLimited(message);
    },
  });
}

export const authLimiter = createLimiter(
  "auth",
  60_000,
  5,
  "Too many auth attempts. Try again later."
);

export const standardLimiter = createLimiter(
  "std",
  60_000,
  100,
  "Request limit reached."
);

export const otpResendLimiter = createLimiter(
  "otp",
  30_000,
  1,
  "Please wait before requesting another OTP."
);
