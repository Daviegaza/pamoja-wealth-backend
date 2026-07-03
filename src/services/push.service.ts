/**
 * Push notifications via Firebase Cloud Messaging (FCM) HTTP v1 API.
 *
 * FCM v1 (2024+) uses OAuth2 service-account auth, not the legacy server key.
 * Env vars required:
 *   FCM_PROJECT_ID          - Firebase project ID
 *   FCM_SERVICE_ACCOUNT_JSON - base64-encoded service account JSON
 *
 * Device tokens live on the UserDevice table (add via migration). For now,
 * tokens are cached in Redis under `push:tokens:{userId}` as a Set.
 */
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";
import { config } from "../config/index.js";
import crypto from "crypto";

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  clickAction?: string;
}

async function getAccessToken(): Promise<string | null> {
  const b64 = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!b64) return null;
  try {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const iat = Math.floor(Date.now() / 1000);
    const claims = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: iat + 3600,
      iat,
    };
    const header = { alg: "RS256", typ: "JWT" };
    const b64url = (s: string) =>
      Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(signingInput)
      .sign(sa.private_key)
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const jwt = `${signingInput}.${signature}`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  } catch (err) {
    logger.error({ err }, "FCM token exchange failed");
    return null;
  }
}

export async function registerDeviceToken(userId: string, token: string): Promise<void> {
  await redis.sadd(`push:tokens:${userId}`, token);
}

export async function unregisterDeviceToken(userId: string, token: string): Promise<void> {
  await redis.srem(`push:tokens:${userId}`, token);
}

export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!config.fcm.serverKey && !process.env.FCM_SERVICE_ACCOUNT_JSON) {
    // Push not configured — silently no-op in dev.
    return;
  }
  const tokens = await redis.smembers(`push:tokens:${userId}`);
  if (tokens.length === 0) return;
  const accessToken = await getAccessToken();
  const projectId = process.env.FCM_PROJECT_ID;
  if (!accessToken || !projectId) return;

  await Promise.all(
    tokens.map(async (token: string) => {
      try {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: payload.title, body: payload.body },
                data: payload.data ?? {},
                webpush: payload.clickAction ? { fcmOptions: { link: payload.clickAction } } : undefined,
              },
            }),
          },
        );
        if (!res.ok) {
          const bodyText = await res.text();
          logger.warn({ status: res.status, bodyText, userId }, "FCM send failed");
          // Invalidate dead tokens.
          if (res.status === 404 || res.status === 400) {
            await unregisterDeviceToken(userId, token);
          }
        }
      } catch (err) {
        logger.warn({ err, userId }, "FCM send error");
      }
    }),
  );
}
