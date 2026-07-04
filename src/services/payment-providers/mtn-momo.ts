/**
 * MTN MoMo Collections API adapter.
 *
 * Uses the Wallet Sandbox / Live Collections product. Docs:
 *   https://momodeveloper.mtn.com/api-documentation
 *
 * Two-legged auth:
 *   1) Basic auth (subscription_key + user_id + api_key) → OAuth token
 *   2) POST /collection/v1_0/requesttopay with X-Reference-Id UUID
 *
 * Env:
 *   MTN_MOMO_ENV=sandbox|production
 *   MTN_MOMO_HOST=https://sandbox.momodeveloper.mtn.com
 *   MTN_MOMO_SUB_KEY=...
 *   MTN_MOMO_USER_ID=...
 *   MTN_MOMO_API_KEY=...
 *   MTN_MOMO_CALLBACK_URL=https://api.pamojawealth.app/webhooks/mtn-momo
 *
 * When creds missing → returns stub result so dev tests continue to run.
 */
import crypto from "crypto";
import { logger } from "../../config/logger.js";

const ENV = process.env.MTN_MOMO_ENV ?? "sandbox";
const HOST = process.env.MTN_MOMO_HOST ?? "https://sandbox.momodeveloper.mtn.com";
const SUB_KEY = process.env.MTN_MOMO_SUB_KEY ?? "";
const USER_ID = process.env.MTN_MOMO_USER_ID ?? "";
const API_KEY = process.env.MTN_MOMO_API_KEY ?? "";
const CALLBACK_URL = process.env.MTN_MOMO_CALLBACK_URL ?? "";

const tokenCache: { token: string; expiresAt: number } = { token: "", expiresAt: 0 };

async function getAccessToken(): Promise<string> {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const basic = Buffer.from(`${USER_ID}:${API_KEY}`).toString("base64");
  const res = await fetch(`${HOST}/collection/token/`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Ocp-Apim-Subscription-Key": SUB_KEY },
  });
  if (!res.ok) throw new Error(`mtn-momo token http ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.token = body.access_token;
  tokenCache.expiresAt = Date.now() + body.expires_in * 1000;
  return tokenCache.token;
}

export async function requestToPay(input: {
  phone: string;
  amount: number;
  currency: "UGX" | "RWF";
  externalId: string;
  narration: string;
}): Promise<{ referenceId: string; status: "initiated" | "failed" }> {
  if (!SUB_KEY || !USER_ID || !API_KEY) {
    logger.warn({ phone: input.phone }, "mtn-momo: creds missing — stub");
    return { referenceId: `stub_mtn_${Date.now()}`, status: "initiated" };
  }

  const token = await getAccessToken();
  const referenceId = crypto.randomUUID();
  const res = await fetch(`${HOST}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Reference-Id": referenceId,
      "X-Target-Environment": ENV,
      "Ocp-Apim-Subscription-Key": SUB_KEY,
      "Content-Type": "application/json",
      ...(CALLBACK_URL ? { "X-Callback-Url": CALLBACK_URL } : {}),
    },
    body: JSON.stringify({
      amount: String(input.amount),
      currency: input.currency,
      externalId: input.externalId,
      payer: { partyIdType: "MSISDN", partyId: input.phone.replace(/[^\d]/g, "") },
      payerMessage: input.narration.slice(0, 160),
      payeeNote: `Pamoja: ${input.narration}`.slice(0, 160),
    }),
  });
  if (res.status !== 202) {
    const detail = await res.text().catch(() => "");
    logger.error({ status: res.status, detail }, "mtn-momo requestToPay failed");
    return { referenceId, status: "failed" };
  }
  return { referenceId, status: "initiated" };
}

export async function requestToPayStatus(referenceId: string): Promise<"PENDING" | "SUCCESSFUL" | "FAILED" | "UNKNOWN"> {
  if (!SUB_KEY) return "UNKNOWN";
  const token = await getAccessToken();
  const res = await fetch(`${HOST}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Target-Environment": ENV,
      "Ocp-Apim-Subscription-Key": SUB_KEY,
    },
  });
  if (!res.ok) return "UNKNOWN";
  const body = (await res.json()) as { status?: string };
  const s = (body.status ?? "").toUpperCase();
  if (s === "SUCCESSFUL" || s === "PENDING" || s === "FAILED") return s as "SUCCESSFUL" | "PENDING" | "FAILED";
  return "UNKNOWN";
}
