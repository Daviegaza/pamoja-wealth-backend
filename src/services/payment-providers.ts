import axios from "axios";
import { config } from "../config/index.js";
import { ApiError } from "../utils/api-error.js";

/**
 * Thin clients for the two SaaS-billing providers. Used ONLY to collect a
 * chama's Pamoja subscription fee. Never used for member contributions.
 */

export type BillingProvider = "flutterwave" | "paystack";

export interface InitCheckoutInput {
  provider: BillingProvider;
  reference: string;
  amountKes: number;
  email: string;
  customerName: string;
  redirectUrl: string;
  description: string;
}

export interface VerifiedPayment {
  /** true only when the provider reports a successful charge. */
  successful: boolean;
  /** true when the provider reports a definitive failure/abandonment. */
  failed: boolean;
  amountKes: number;
  currency: string;
  reference: string;
  providerTransactionId: string | null;
  rawStatus: string;
}

const http = axios.create({ timeout: 15_000 });

function requireKey(provider: BillingProvider): string {
  const key = provider === "flutterwave" ? config.flutterwave.secretKey : config.paystack.secretKey;
  if (!key) {
    throw new ApiError("PAYMENT_PROVIDER_UNAVAILABLE", `${provider} is not configured`, 503);
  }
  return key;
}

async function initCheckout(input: InitCheckoutInput): Promise<string> {
  const key = requireKey(input.provider);
  try {
    if (input.provider === "flutterwave") {
      const res = await http.post(
        `${config.flutterwave.baseUrl}/payments`,
        {
          tx_ref: input.reference,
          amount: input.amountKes,
          currency: "KES",
          redirect_url: input.redirectUrl,
          customer: { email: input.email, name: input.customerName },
          customizations: { title: "Pamoja Wealth subscription", description: input.description },
        },
        { headers: { Authorization: `Bearer ${key}` } },
      );
      const link = res.data?.data?.link;
      if (typeof link !== "string") throw new Error("missing checkout link");
      return link;
    }
    const res = await http.post(
      `${config.paystack.baseUrl}/transaction/initialize`,
      {
        email: input.email,
        amount: Math.round(input.amountKes * 100), // Paystack uses the minor unit
        currency: "KES",
        reference: input.reference,
        callback_url: input.redirectUrl,
        metadata: { description: input.description },
      },
      { headers: { Authorization: `Bearer ${key}` } },
    );
    const url = res.data?.data?.authorization_url;
    if (typeof url !== "string") throw new Error("missing authorization_url");
    return url;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("PAYMENT_PROVIDER_UNAVAILABLE", `Could not start ${input.provider} checkout`, 502);
  }
}

/**
 * Ask the provider (server-to-server) what actually happened to `reference`.
 * Throws on network/provider errors so callers can retry later; returns a
 * normalised result otherwise.
 */
async function verifyPayment(provider: BillingProvider, reference: string): Promise<VerifiedPayment> {
  const key = requireKey(provider);
  if (provider === "flutterwave") {
    const res = await http.get(`${config.flutterwave.baseUrl}/transactions/verify_by_reference`, {
      params: { tx_ref: reference },
      headers: { Authorization: `Bearer ${key}` },
      validateStatus: (s) => s < 500,
    });
    const d = res.data?.data ?? {};
    const status = String(d.status ?? res.data?.status ?? "unknown").toLowerCase();
    return {
      successful: res.status === 200 && status === "successful",
      failed: status === "failed" || status === "cancelled",
      amountKes: Number(d.amount ?? 0),
      currency: String(d.currency ?? ""),
      reference: String(d.tx_ref ?? ""),
      providerTransactionId: d.id !== undefined ? String(d.id) : null,
      rawStatus: status,
    };
  }
  const res = await http.get(`${config.paystack.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${key}` },
    validateStatus: (s) => s < 500,
  });
  const d = res.data?.data ?? {};
  const status = String(d.status ?? "unknown").toLowerCase();
  return {
    successful: res.status === 200 && status === "success",
    failed: status === "failed" || status === "abandoned" || status === "reversed",
    amountKes: Number(d.amount ?? 0) / 100,
    currency: String(d.currency ?? ""),
    reference: String(d.reference ?? ""),
    providerTransactionId: d.id !== undefined ? String(d.id) : null,
    rawStatus: status,
  };
}

/**
 * Indirection object so tests can stub the network calls
 * (`jest.spyOn(providerClient, "verifyPayment")`) without module mocking.
 */
export const providerClient = { initCheckout, verifyPayment };
