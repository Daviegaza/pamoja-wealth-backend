import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { JwtPayload } from "../types/index.js";
import { redis } from "../config/redis.js";

/**
 * Refresh tokens are single-use and server-tracked:
 *   - every refresh token carries a random `jti`;
 *   - `refresh:<userId>:<jti>` exists in Redis while the token is valid;
 *   - rotation deletes the old key atomically (DEL returns 1 only once), so a
 *     replayed token is rejected and treated as theft -> all sessions revoked;
 *   - logout deletes the presented token; password reset revokes everything.
 * If Redis is unavailable refresh fails closed (user must log in again).
 */

const refreshKey = (userId: string, jti: string) => `refresh:${userId}:${jti}`;
const refreshPattern = (userId: string) => `refresh:${userId}:*`;

type TokenSubject = Pick<JwtPayload, "userId" | "email">;

export function generateAccessToken(payload: TokenSubject): string {
  return jwt.sign({ userId: payload.userId, email: payload.email, type: "access" }, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiry,
    algorithm: "HS256",
  } as jwt.SignOptions);
}

export async function issueRefreshToken(payload: TokenSubject): Promise<string> {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { userId: payload.userId, email: payload.email, type: "refresh", jti },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiry, algorithm: "HS256" } as jwt.SignOptions,
  );
  await redis.set(refreshKey(payload.userId, jti), "1", "EX", config.jwt.refreshTtlSeconds);
  return token;
}

function verifyToken(token: string, secret: string, expectedType: JwtPayload["type"]): JwtPayload {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as JwtPayload;
  if (payload.type !== expectedType) {
    throw new jwt.JsonWebTokenError("wrong token type");
  }
  return payload;
}

export function verifyAccessToken(token: string): JwtPayload {
  return verifyToken(token, config.jwt.secret, "access");
}

export function verifyRefreshToken(token: string): JwtPayload {
  return verifyToken(token, config.jwt.refreshSecret, "refresh");
}

export async function rotateRefreshToken(
  oldToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  let payload: JwtPayload;
  try {
    payload = verifyRefreshToken(oldToken);
  } catch {
    return null;
  }
  if (!payload.jti) return null;

  const removed: number = await redis.del(refreshKey(payload.userId, payload.jti));
  if (removed !== 1) {
    // Valid signature but not on the allow-list: either already used
    // (replay) or revoked. Revoke every session for this user.
    await revokeAllRefreshTokens(payload.userId);
    return null;
  }

  const subject = { userId: payload.userId, email: payload.email };
  return {
    accessToken: generateAccessToken(subject),
    refreshToken: await issueRefreshToken(subject),
  };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const payload = verifyRefreshToken(token);
    if (payload.jti) await redis.del(refreshKey(payload.userId, payload.jti));
  } catch {
    // Invalid/expired token: nothing to revoke.
  }
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys]: [string, string[]] = await redis.scan(cursor, "MATCH", refreshPattern(userId), "COUNT", 100);
    if (keys.length > 0) await redis.del(...keys);
    cursor = next;
  } while (cursor !== "0");
}
