/**
 * Paystack — Nigeria card + bank transfer collection.
 *
 * Docs: https://paystack.com/docs/api
 *
 * Env:
 *   PAYSTACK_SECRET_KEY=sk_live_... or sk_test_...
 *   PAYSTACK_CALLBACK_URL=https://pamojawealth.app/pay/callback
 */
import { logger } from "../../config/logger.js";

const HOST = "https://api.paystack.co";
const SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";
const CALLBACK = process.env.PAYSTACK_CALLBACK_URL ?? "";

export async function initializeTransaction(input: {
  email: string;
  amountNaira: number;
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string | null; reference: string; status: "initiated" | "failed" }> {
  if (!SECRET) {
    logger.warn({ email: input.email }, "paystack: secret missing — stub");
    return { authorizationUrl: null, reference: input.reference, status: "initiated" };
  }
  const res = await fetch(`${HOST}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      amount: Math.round(input.amountNaira * 100), // kobo
      reference: input.reference,
      callback_url: CALLBACK || undefined,
      metadata: input.metadata,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { authorization_url?: string; reference?: string }; status?: boolean };
  if (!res.ok || !body.status) {
    logger.error({ status: res.status, body }, "paystack initializeTransaction failed");
    return { authorizationUrl: null, reference: input.reference, status: "failed" };
  }
  return {
    authorizationUrl: body.data?.authorization_url ?? null,
    reference: body.data?.reference ?? input.reference,
    status: "initiated",
  };
}

export async function verifyTransaction(reference: string): Promise<{ status: "success" | "failed" | "abandoned" | "unknown"; amountNaira?: number }> {
  if (!SECRET) return { status: "unknown" };
  const res = await fetch(`${HOST}/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { status?: string; amount?: number }; status?: boolean };
  if (!res.ok || !body.status) return { status: "unknown" };
  const s = body.data?.status;
  if (s === "success" || s === "failed" || s === "abandoned") {
    return { status: s, amountNaira: (body.data?.amount ?? 0) / 100 };
  }
  return { status: "unknown" };
}
