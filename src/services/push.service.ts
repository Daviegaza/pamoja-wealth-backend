/**
 * Push notifications — FCM (Android) + APNs (iOS) via HTTP/2.
 *
 * FCM v1 (2024+) uses OAuth2 service-account auth.
 * APNs uses JWT-based auth with the Apple Developer key.
 *
 * Device tokens are cached in Redis under `push:tokens:{userId}` as a Set.
 * Each token is prefixed with its platform: `fcm:` or `apns:`.
 *
 * Env vars:
 *   FCM_PROJECT_ID           - Firebase project ID
 *   FCM_SERVICE_ACCOUNT_JSON - base64-encoded service account JSON
 *   APNS_KEY_ID              - Apple APNs key ID (from developer.apple.com)
 *   APNS_TEAM_ID             - Apple Team ID
 *   APNS_KEY_BASE64          - base64-encoded .p8 private key
 *   APNS_TOPIC               - App bundle ID (com.pamojawealth.app)
 */
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";
import crypto from "crypto";

// ── Types ────────────────────────────────────────────────────────────────

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  clickAction?: string;
  badge?: number;
  sound?: string;
}

type DevicePlatform = "fcm" | "apns";

// ── FCM OAuth2 ──────────────────────────────────────────────────────────

let fcmTokenCache: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(): Promise<string | null> {
  if (fcmTokenCache && fcmTokenCache.expiresAt > Date.now() + 60000) {
    return fcmTokenCache.token;
  }
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
    if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    fcmTokenCache = { token: json.access_token, expiresAt: Date.now() + 3000000 }; // 50 min
    return json.access_token;
  } catch (err) {
    logger.error({ err }, "FCM token exchange failed");
    return null;
  }
}

// ── APNs JWT ────────────────────────────────────────────────────────────

let apnsJwtCache: { token: string; expiresAt: number } | null = null;

function getApnsJwt(): string | null {
  if (apnsJwtCache && apnsJwtCache.expiresAt > Date.now() + 60000) {
    return apnsJwtCache.token;
  }
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const keyB64 = process.env.APNS_KEY_BASE64;
  if (!keyId || !teamId || !keyB64) return null;

  try {
    const privateKey = Buffer.from(keyB64, "base64").toString("utf8");
    const iat = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", kid: keyId };
    const claims = { iss: teamId, iat };
    const b64url = (s: string) =>
      Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(signingInput)
      .sign(privateKey)
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const jwt = `${signingInput}.${signature}`;
    apnsJwtCache = { token: jwt, expiresAt: Date.now() + 3000000 };
    return jwt;
  } catch (err) {
    logger.error({ err }, "APNs JWT generation failed");
    return null;
  }
}

async function sendApnsPush(deviceToken: string, payload: PushPayload): Promise<boolean> {
  const jwt = getApnsJwt();
  const topic = process.env.APNS_TOPIC || "com.pamojawealth.app";
  const isProduction = process.env.NODE_ENV === "production";
  const host = isProduction
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";

  if (!jwt) return false;

  const aps: any = {
    alert: { title: payload.title, body: payload.body },
    sound: payload.sound || "default",
    "content-available": 1,
  };
  if (payload.badge !== undefined) aps.badge = payload.badge;

  const body: any = { aps };
  if (payload.data) {
    for (const [key, value] of Object.entries(payload.data)) {
      body[key] = value;
    }
  }
  if (payload.clickAction) {
    body.clickAction = payload.clickAction;
  }

  try {
    const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
      method: "POST",
      headers: {
        Authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-expiration": "0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return true;

    // 410 = token no longer valid
    if (res.status === 410) return false;

    const reason = await res.text();
    logger.warn({ status: res.status, reason, deviceToken }, "APNs send failed");
    return res.status !== 400; // 400 = bad token
  } catch (err) {
    logger.warn({ err, deviceToken }, "APNs send error");
    return true; // assume transient error, keep token
  }
}

async function sendFcmPush(deviceToken: string, payload: PushPayload): Promise<boolean> {
  const accessToken = await getFcmAccessToken();
  const projectId = process.env.FCM_PROJECT_ID;
  if (!accessToken || !projectId) return true; // not configured = keep token

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
            token: deviceToken,
            notification: { title: payload.title, body: payload.body },
            data: payload.data ?? {},
            android: {
              notification: {
                channelId: "pamoja_default",
                sound: payload.sound || "default",
              },
            },
            webpush: payload.clickAction
              ? { fcmOptions: { link: payload.clickAction } }
              : undefined,
          },
        }),
      },
    );
    if (!res.ok) {
      const bodyText = await res.text();
      logger.warn({ status: res.status, bodyText, deviceToken }, "FCM send failed");
      if (res.status === 404 || res.status === 400) return false; // dead token
    }
    return true;
  } catch (err) {
    logger.warn({ err, deviceToken }, "FCM send error");
    return true; // assume transient
  }
}

// ── Platform detection ──────────────────────────────────────────────────

function detectPlatform(token: string): DevicePlatform {
  // APNs tokens are 64+ hex chars (or base64, but always start with hex)
  // FCM tokens are shorter and contain a colon separator (e.g., "fZqR...:APA91...")
  if (token.length >= 64 && /^[a-fA-F0-9]+$/.test(token)) return "apns";
  return "fcm";
}

// ── Public API ──────────────────────────────────────────────────────────

export async function registerDeviceToken(
  userId: string,
  token: string,
): Promise<void> {
  const platform = detectPlatform(token);
  await redis.sadd(`push:tokens:${userId}`, `${platform}:${token}`);
}

export async function unregisterDeviceToken(
  userId: string,
  token: string,
): Promise<void> {
  const platform = detectPlatform(token);
  await redis.srem(`push:tokens:${userId}`, `${platform}:${token}`);
}

export async function sendPush(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const rawTokens = await redis.smembers(`push:tokens:${userId}`);
  if (rawTokens.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  await Promise.all(
    rawTokens.map(async (prefixed: string) => {
      const [platform, token] = prefixed.split(":") as [DevicePlatform, string];
      if (!token) return;

      let ok: boolean;
      if (platform === "apns") {
        ok = await sendApnsPush(token, payload);
      } else {
        ok = await sendFcmPush(token, payload);
      }

      if (ok) {
        sent++;
      } else {
        failed++;
        await redis.srem(`push:tokens:${userId}`, prefixed);
      }
    }),
  );

  logger.info(
    { userId, sent, failed, total: rawTokens.length },
    "push.sendPush complete",
  );
  return { sent, failed };
}

/**
 * Send push to multiple users at once (batch notification).
 */
export async function sendPushBatch(
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  await Promise.all(userIds.map((uid) => sendPush(uid, payload)));
}
