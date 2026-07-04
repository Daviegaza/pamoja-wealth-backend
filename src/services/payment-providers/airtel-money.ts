/**
 * Airtel Money OpenAPI (v2) — Collections adapter.
 *
 * Docs: https://developers.airtel.africa
 *
 * Auth:
 *   POST /auth/oauth2/token (client_credentials)
 * Push:
 *   POST /merchant/v1/payments/
 *
 * Env:
 *   AIRTEL_HOST=https://openapi.airtel.africa   (or sandbox host)
 *   AIRTEL_CLIENT_ID=...
 *   AIRTEL_CLIENT_SECRET=...
 *   AIRTEL_CALLBACK_URL=https://api.pamojawealth.app/webhooks/airtel
 */
import { logger } from "../../config/logger.js";

const HOST = process.env.AIRTEL_HOST ?? "https://openapiuat.airtel.africa";
const CLIENT_ID = process.env.AIRTEL_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.AIRTEL_CLIENT_SECRET ?? "";

const tokenCache: { token: string; expiresAt: number } = { token: "", expiresAt: 0 };

async function getAccessToken(): Promise<string> {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const res = await fetch(`${HOST}/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`airtel token http ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.token = body.access_token;
  tokenCache.expiresAt = Date.now() + body.expires_in * 1000;
  return tokenCache.token;
}

export async function pushCollect(input: {
  phone: string;
  amount: number;
  country: "UG" | "TZ" | "RW";
  currency: "UGX" | "TZS" | "RWF";
  reference: string;
  narration: string;
}): Promise<{ referenceId: string; status: "initiated" | "failed" }> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    logger.warn({ phone: input.phone }, "airtel: creds missing — stub");
    return { referenceId: `stub_airtel_${Date.now()}`, status: "initiated" };
  }
  const token = await getAccessToken();
  const res = await fetch(`${HOST}/merchant/v1/payments/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Country": input.country,
      "X-Currency": input.currency,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reference: input.reference,
      subscriber: { country: input.country, currency: input.currency, msisdn: input.phone.replace(/[^\d]/g, "") },
      transaction: { amount: input.amount, country: input.country, currency: input.currency, id: input.reference },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.error({ status: res.status, detail }, "airtel pushCollect failed");
    return { referenceId: input.reference, status: "failed" };
  }
  return { referenceId: input.reference, status: "initiated" };
}
