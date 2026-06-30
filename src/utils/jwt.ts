import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { JwtPayload } from "../types/index.js";
import { redis } from "../config/redis.js";

export function generateAccessToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiry,
  } as jwt.SignOptions);
}

export function generateRefreshToken(payload: Omit<JwtPayload, "type">): string {
  const token = jwt.sign({ ...payload, type: "refresh" }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiry,
  } as jwt.SignOptions);
  return token;
}

export function verifyToken(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload;
}

export function verifyAccessToken(token: string): JwtPayload {
  return verifyToken(token, config.jwt.secret);
}

export function verifyRefreshToken(token: string): JwtPayload {
  return verifyToken(token, config.jwt.refreshSecret);
}

export async function rotateRefreshToken(
  oldToken: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const payload = verifyRefreshToken(oldToken);
    const blocked = await redis.get(`blocked:refresh:${payload.userId}`);
    if (blocked === oldToken) return null;

    // Block the old token
    await redis.set(`blocked:refresh:${payload.userId}`, oldToken, "EX", 7 * 24 * 3600);

    const newPayload = { userId: payload.userId, email: payload.email };
    return {
      accessToken: generateAccessToken(newPayload),
      refreshToken: generateRefreshToken(newPayload),
    };
  } catch {
    return null;
  }
}

export async function invalidateRefreshTokens(userId: string): Promise<void> {
  await redis.del(`blocked:refresh:${userId}`);
}
