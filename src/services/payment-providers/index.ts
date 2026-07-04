/**
 * Multi-provider payment router.
 *
 * Kenya    (KES): Safaricom M-Pesa (Daraja)
 * Uganda   (UGX): MTN MoMo, Airtel Money
 * Tanzania (TZS): Vodacom M-Pesa TZ, Airtel Money, Tigo Pesa
 * Rwanda   (RWF): MTN MoMo, Airtel Money
 * Nigeria  (NGN): Paystack (card), Flutterwave (card + bank)
 *
 * Interface below normalises the mobile-money "collection" flow (push
 * request to payer's phone). Each provider stubs `initiate` and
 * `verifyCallback` — real Daraja is wired in `mpesa.service.ts`; the
 * others land per-country in follow-up PRs.
 */
import type { Currency } from "../fx.service.js";
import { logger } from "../../config/logger.js";
import { stkPush as darajaSTK } from "../mpesa.service.js";
import { requestToPay as mtnRequestToPay } from "./mtn-momo.js";
import { pushCollect as airtelPushCollect } from "./airtel-money.js";
import { initializeTransaction as paystackInit } from "./paystack.js";
import { createChargeLink as flwCreateLink } from "./flutterwave.js";

export type ProviderId =
  | "mpesa_ke"
  | "mpesa_tz"
  | "mtn_momo_ug"
  | "mtn_momo_rw"
  | "airtel_ug"
  | "airtel_tz"
  | "airtel_rw"
  | "tigo_tz"
  | "paystack_ng"
  | "flutterwave_ng";

export interface CollectionInput {
  phone: string;           // MSISDN in provider-native format
  amount: number;          // canonical minor units (KES → shillings)
  currency: Currency;
  accountRef: string;      // idempotent chama ref
  description: string;
}

export interface CollectionResult {
  provider: ProviderId;
  externalRef: string;     // ConversationID / CheckoutRequestID / etc.
  status: "initiated" | "failed";
  raw?: unknown;
}

export interface Provider {
  id: ProviderId;
  currencies: Currency[];
  countries: string[];
  initiate: (input: CollectionInput) => Promise<CollectionResult>;
  disburse?: (phone: string, amount: number, remarks: string) => Promise<{ externalRef: string }>;
}

// ── Providers ─────────────────────────────────────────────────────

const daraja: Provider = {
  id: "mpesa_ke",
  currencies: ["KES"],
  countries: ["KE"],
  async initiate({ phone, amount, accountRef }) {
    const { checkoutRequestId } = await darajaSTK(phone, amount, accountRef);
    return { provider: "mpesa_ke", externalRef: checkoutRequestId, status: "initiated" };
  },
};

async function stubProvider(id: ProviderId, input: CollectionInput): Promise<CollectionResult> {
  logger.warn({ id, phone: input.phone, amount: input.amount }, "provider stub — not sent (integration pending)");
  return {
    provider: id,
    externalRef: `stub_${id}_${Date.now()}`,
    status: "initiated",
  };
}

function stub(id: ProviderId, currencies: Currency[], countries: string[]): Provider {
  return {
    id,
    currencies,
    countries,
    initiate: (i) => stubProvider(id, i),
  };
}

const mtnMomoUg: Provider = {
  id: "mtn_momo_ug",
  currencies: ["UGX"],
  countries: ["UG"],
  async initiate({ phone, amount, accountRef, description, currency }) {
    if (currency !== "UGX" && currency !== "RWF") throw new Error("mtn-momo: unsupported currency");
    const r = await mtnRequestToPay({ phone, amount, currency, externalId: accountRef, narration: description });
    return { provider: "mtn_momo_ug", externalRef: r.referenceId, status: r.status };
  },
};
const mtnMomoRw: Provider = { ...mtnMomoUg, id: "mtn_momo_rw", currencies: ["RWF"], countries: ["RW"] };

function airtelProvider(id: ProviderId, country: "UG" | "TZ" | "RW", currency: "UGX" | "TZS" | "RWF"): Provider {
  return {
    id,
    currencies: [currency],
    countries: [country],
    async initiate({ phone, amount, accountRef, description }) {
      const r = await airtelPushCollect({ phone, amount, country, currency, reference: accountRef, narration: description });
      return { provider: id, externalRef: r.referenceId, status: r.status };
    },
  };
}

const paystackNg: Provider = {
  id: "paystack_ng",
  currencies: ["NGN"],
  countries: ["NG"],
  async initiate({ amount, accountRef, description, phone }) {
    // Paystack needs email — synthetic email built from phone when missing.
    const email = `${(phone || "user").replace(/[^\d]/g, "")}@paystack.pamojawealth.app`;
    const r = await paystackInit({ email, amountNaira: amount, reference: accountRef, metadata: { description } });
    return { provider: "paystack_ng", externalRef: r.reference, status: r.status };
  },
};

const flwNg: Provider = {
  id: "flutterwave_ng",
  currencies: ["NGN"],
  countries: ["NG"],
  async initiate({ amount, accountRef, description, phone, currency }) {
    const email = `${(phone || "user").replace(/[^\d]/g, "")}@flw.pamojawealth.app`;
    const r = await flwCreateLink({
      txRef: accountRef,
      amount,
      currency: currency as "NGN",
      customer: { email, name: "Pamoja Wealth user", phone },
      description,
    });
    return { provider: "flutterwave_ng", externalRef: r.txRef, status: r.status };
  },
};

const providers: Provider[] = [
  daraja,
  stub("mpesa_tz", ["TZS"], ["TZ"]),
  mtnMomoUg,
  mtnMomoRw,
  airtelProvider("airtel_ug", "UG", "UGX"),
  airtelProvider("airtel_tz", "TZ", "TZS"),
  airtelProvider("airtel_rw", "RW", "RWF"),
  stub("tigo_tz", ["TZS"], ["TZ"]),
  paystackNg,
  flwNg,
];

// ── Router ────────────────────────────────────────────────────────

/**
 * Detect a phone's country from its MSISDN and pick the first provider
 * matching (country, currency). Explicit provider hint wins.
 */
export function pickProvider(currency: Currency, phone: string, hint?: ProviderId): Provider {
  if (hint) {
    const found = providers.find((p) => p.id === hint);
    if (found) return found;
  }
  const country = countryFromMsisdn(phone);
  const match = providers.find((p) => p.currencies.includes(currency) && (!country || p.countries.includes(country)));
  if (match) return match;
  throw new Error(`no provider for ${currency} + ${country ?? "unknown-country"}`);
}

export function countryFromMsisdn(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("254")) return "KE";
  if (digits.startsWith("255")) return "TZ";
  if (digits.startsWith("256")) return "UG";
  if (digits.startsWith("250")) return "RW";
  if (digits.startsWith("234")) return "NG";
  return null;
}

export async function collect(input: CollectionInput, hint?: ProviderId): Promise<CollectionResult> {
  const provider = pickProvider(input.currency, input.phone, hint);
  return provider.initiate(input);
}

export function listProviders(): Array<{ id: ProviderId; currencies: Currency[]; countries: string[] }> {
  return providers.map(({ id, currencies, countries }) => ({ id, currencies, countries }));
}
