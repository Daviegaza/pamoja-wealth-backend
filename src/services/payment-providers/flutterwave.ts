/**
 * Flutterwave — v3 charge API (card + bank + mobile-money multi-country).
 *
 * Docs: https://developer.flutterwave.com/docs
 *
 * Env:
 *   FLUTTERWAVE_SECRET_KEY=FLWSECK-...
 *   FLUTTERWAVE_REDIRECT_URL=https://pamojawealth.app/pay/flw-callback
 */
import { logger } from "../../config/logger.js";

const HOST = "https://api.flutterwave.com/v3";
const SECRET = process.env.FLUTTERWAVE_SECRET_KEY ?? "";
const REDIRECT = process.env.FLUTTERWAVE_REDIRECT_URL ?? "";

export async function createChargeLink(input: {
  txRef: string;
  amount: number;
  currency: "NGN" | "KES" | "UGX" | "TZS" | "RWF" | "USD";
  customer: { email: string; name: string; phone?: string };
  description: string;
}): Promise<{ paymentLink: string | null; txRef: string; status: "initiated" | "failed" }> {
  if (!SECRET) {
    logger.warn({ email: input.customer.email }, "flutterwave: secret missing — stub");
    return { paymentLink: null, txRef: input.txRef, status: "initiated" };
  }
  const res = await fetch(`${HOST}/payments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: input.txRef,
      amount: input.amount,
      currency: input.currency,
      redirect_url: REDIRECT || undefined,
      customer: input.customer,
      customizations: { title: "Pamoja Wealth", description: input.description },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { link?: string }; status?: string };
  if (!res.ok || body.status !== "success") {
    logger.error({ status: res.status, body }, "flutterwave createChargeLink failed");
    return { paymentLink: null, txRef: input.txRef, status: "failed" };
  }
  return { paymentLink: body.data?.link ?? null, txRef: input.txRef, status: "initiated" };
}

export async function verifyTransaction(txId: string): Promise<{ status: "successful" | "failed" | "pending" | "unknown"; amount?: number; currency?: string }> {
  if (!SECRET) return { status: "unknown" };
  const res = await fetch(`${HOST}/transactions/${txId}/verify`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { status?: string; amount?: number; currency?: string }; status?: string };
  if (!res.ok) return { status: "unknown" };
  const s = body.data?.status;
  if (s === "successful" || s === "failed" || s === "pending") {
    return { status: s, amount: body.data?.amount, currency: body.data?.currency };
  }
  return { status: "unknown" };
}
