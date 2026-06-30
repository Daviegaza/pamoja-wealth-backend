import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/api-error.js";

function createLimiter(windowMs: number, max: number, message: string) {
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res) => {
      throw ApiError.rateLimited(message);
    },
  });
}

export const authLimiter = createLimiter(
  60_000,
  5,
  "Too many auth attempts. Try again later."
);

export const aiLimiter = createLimiter(
  60_000,
  20,
  "AI request limit reached. Try again in a minute."
);

export const standardLimiter = createLimiter(
  60_000,
  100,
  "Request limit reached."
);

export const uploadLimiter = createLimiter(
  60_000,
  10,
  "Upload limit reached. Try again later."
);

export const otpResendLimiter = createLimiter(
  30_000,
  1,
  "Please wait before requesting another OTP."
);
