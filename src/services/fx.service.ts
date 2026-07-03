/**
 * Multi-currency + FX. Base = KES. Rates cached in Redis 6h.
 */
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";

export type Currency = "KES" | "USD" | "EUR" | "GBP" | "TZS" | "UGX" | "RWF";
export const SUPPORTED: Currency[] = ["KES", "USD", "EUR", "GBP", "TZS", "UGX", "RWF"];

const BASELINE: Record<Currency, number> = {
  KES: 1, USD: 0.0077, EUR: 0.0071, GBP: 0.0061, TZS: 19.5, UGX: 28.1, RWF: 10.4,
};

const CACHE_KEY = "fx:rates";
const CACHE_TTL_SECONDS = 6 * 60 * 60;

interface RateSet {
  base: "KES";
  rates: Record<Currency, number>;
  fetchedAt: string;
  source: string;
}

async function fetchExchangerateHost(): Promise<RateSet | null> {
  try {
    const symbols = SUPPORTED.filter((c) => c !== "KES").join(",");
    const res = await fetch(`https://api.exchangerate.host/latest?base=KES&symbols=${symbols}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { rates: Record<string, number> };
    const rates = { ...BASELINE, ...json.rates } as Record<Currency, number>;
    rates.KES = 1;
    return { base: "KES", rates, fetchedAt: new Date().toISOString(), source: "exchangerate.host" };
  } catch (err) {
    logger.warn({ err }, "fx: fetch failed");
    return null;
  }
}

export async function getRates(): Promise<RateSet> {
  const cached = await redis.get(CACHE_KEY);
  if (cached) return JSON.parse(cached) as RateSet;
  const live = await fetchExchangerateHost();
  const set: RateSet = live ?? {
    base: "KES", rates: BASELINE,
    fetchedAt: new Date().toISOString(), source: "baseline",
  };
  await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(set));
  return set;
}

export async function convert(amountKes: number, target: Currency): Promise<number> {
  if (target === "KES") return amountKes;
  const set = await getRates();
  const rate = set.rates[target] ?? BASELINE[target];
  return Math.round(amountKes * rate * 100) / 100;
}

export async function convertToKes(amount: number, from: Currency): Promise<number> {
  if (from === "KES") return amount;
  const set = await getRates();
  const rate = set.rates[from] ?? BASELINE[from];
  if (!rate) return amount;
  return Math.round((amount / rate) * 100) / 100;
}

export function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KES" ? 0 : 2,
  }).format(amount);
}
