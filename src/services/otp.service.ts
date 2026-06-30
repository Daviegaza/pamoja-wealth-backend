import { redis } from "../config/redis.js";
import { generateOtpCode } from "../utils/reference.js";

const OTP_PREFIX = "otp:";
const OTP_TTL = 300; // 5 minutes
const RESEND_TTL = 30; // 30 seconds cooldown
const MAX_ATTEMPTS = 5;

export async function generateOtp(userId: string): Promise<string> {
  const code = generateOtpCode();
  const key = `${OTP_PREFIX}${userId}`;
  await redis.set(key, code, "EX", OTP_TTL);
  await redis.set(`${key}:attempts`, "0", "EX", OTP_TTL);
  return code;
}

export async function verifyOtp(userId: string, code: string): Promise<boolean> {
  const key = `${OTP_PREFIX}${userId}`;
  const attemptsKey = `${key}:attempts`;

  const attempts = parseInt((await redis.get(attemptsKey)) || "0", 10);
  if (attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    await redis.del(attemptsKey);
    return false;
  }

  const stored = await redis.get(key);
  if (!stored) return false;

  if (stored === code) {
    await redis.del(key);
    await redis.del(attemptsKey);
    return true;
  }

  await redis.incr(attemptsKey);
  return false;
}

export async function canResendOtp(userId: string): Promise<boolean> {
  const key = `${OTP_PREFIX}${userId}:resend`;
  const exists = await redis.get(key);
  if (exists) return false;
  await redis.set(key, "1", "EX", RESEND_TTL);
  return true;
}
