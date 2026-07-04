/**
 * Yellow Card — Africa fiat↔crypto onramp for USDC savings vault.
 *
 * Chamas can opt in to hold a % of their pool in USDC (Yellow Card
 * business API) as an inflation hedge. Deposits: KES → USDC via YC.
 * Withdrawals: USDC → KES to member wallets on demand.
 *
 * Env:
 *   YELLOWCARD_HOST=https://api.yellowcard.io
 *   YELLOWCARD_API_KEY=
 *   YELLOWCARD_API_SECRET=
 *
 * MVP: stub adapter — logs intent, returns synthetic quote. Real HMAC
 * signing lands with the production credential.
 */
import { logger } from "../../config/logger.js";

const HOST = process.env.YELLOWCARD_HOST ?? "https://sandbox.yellowcard.io/business/v1";
const API_KEY = process.env.YELLOWCARD_API_KEY ?? "";
const API_SECRET = process.env.YELLOWCARD_API_SECRET ?? "";

export interface UsdcQuote {
  quoteId: string;
  amountKes: number;
  rateKesPerUsdc: number;
  usdcOut: number;
  expiresAt: string;
  feeKes: number;
}

export interface UsdcVaultDeposit {
  quoteId: string;
  txId: string;
  status: "pending" | "confirmed" | "failed";
  usdcHeld: number;
}

/**
 * Real: POST /quote. Stub: derives a synthetic rate around KES 130/USDC.
 */
export async function quoteDeposit(amountKes: number): Promise<UsdcQuote> {
  if (!API_KEY || !API_SECRET) {
    const rateKesPerUsdc = 130 + (Math.random() * 2 - 1); // ±1 KES jitter
    const feeKes = Math.round(amountKes * 0.008); // 0.8% platform fee
    return {
      quoteId: `stub_${Date.now()}`,
      amountKes,
      rateKesPerUsdc,
      usdcOut: Math.round(((amountKes - feeKes) / rateKesPerUsdc) * 100) / 100,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      feeKes,
    };
  }
  const res = await fetch(`${HOST}/collections/quote`, {
    method: "POST",
    headers: {
      "X-YC-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currency: "KES",
      amount: amountKes,
      convertTo: "USDC",
    }),
  });
  if (!res.ok) throw new Error(`yellowcard quote http ${res.status}`);
  const body = await res.json() as { quoteId: string; rate: number; usdcOut: number; feeKes: number; expiresAt: string };
  return {
    quoteId: body.quoteId,
    amountKes,
    rateKesPerUsdc: body.rate,
    usdcOut: body.usdcOut,
    expiresAt: body.expiresAt,
    feeKes: body.feeKes,
  };
}

export async function executeDeposit(quoteId: string): Promise<UsdcVaultDeposit> {
  if (!API_KEY || !API_SECRET) {
    logger.warn({ quoteId }, "yellowcard: creds missing — stub deposit");
    return {
      quoteId,
      txId: `stub_tx_${Date.now()}`,
      status: "pending",
      usdcHeld: 0,
    };
  }
  const res = await fetch(`${HOST}/collections/execute`, {
    method: "POST",
    headers: {
      "X-YC-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ quoteId }),
  });
  if (!res.ok) throw new Error(`yellowcard execute http ${res.status}`);
  const body = await res.json() as { txId: string; status: string; usdcHeld: number };
  return {
    quoteId,
    txId: body.txId,
    status: (body.status as UsdcVaultDeposit["status"]) ?? "pending",
    usdcHeld: body.usdcHeld,
  };
}

export async function quoteWithdrawal(usdcAmount: number): Promise<{ quoteId: string; kesOut: number; rateKesPerUsdc: number; feeKes: number; expiresAt: string }> {
  if (!API_KEY || !API_SECRET) {
    const rateKesPerUsdc = 129 + (Math.random() * 2 - 1);
    const kesGross = Math.round(usdcAmount * rateKesPerUsdc);
    const feeKes = Math.round(kesGross * 0.008);
    return {
      quoteId: `stub_wd_${Date.now()}`,
      kesOut: kesGross - feeKes,
      rateKesPerUsdc,
      feeKes,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  const res = await fetch(`${HOST}/payments/quote`, {
    method: "POST",
    headers: { "X-YC-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ currency: "USDC", amount: usdcAmount, convertTo: "KES" }),
  });
  if (!res.ok) throw new Error(`yellowcard withdrawal quote http ${res.status}`);
  return await res.json() as { quoteId: string; kesOut: number; rateKesPerUsdc: number; feeKes: number; expiresAt: string };
}
