/**
 * Platform fees (Revenue stream 3 — B2C payout fee).
 *
 * B2C payouts (chama pool → member M-Pesa) carry a thin platform fee:
 *
 *     payoutFeeKes = clamp(amount * 0.5%, min: 30, max: 500)
 *
 * Rationale (RESEARCH_DOSSIER §1 — M-Changa fee backlash):
 *   - 0.5% is well below M-Changa's 4.25-15% and below typical Safaricom B2C
 *     transaction costs absorbed by us. Bounded floor/ceiling so a 10K
 *     payout costs KES 50 (not KES 5) and a 500K payout doesn't cost KES
 *     2,500.
 *   - Fee is disclosed BEFORE the treasurer signs the payout request — see
 *     `quotePayout()`. Anti-bait-and-switch is the explicit lesson from the
 *     Rex Masai cancer-treatment incident.
 *
 * The fee is posted via the existing double-entry ledger:
 *   DR chama_pool_wallet / CR platform_fee_revenue
 *
 * Idempotency: the caller provides a payout idempotency key; we derive
 *   `b2c-payout-fee:{payoutKey}` for the ledger posting so retries replay
 *   instead of double-charging.
 */

import { Decimal } from "@prisma/client/runtime/client";
import * as ledger from "./ledger.service.js";

const B2C_FEE_RATE = new Decimal("0.005"); // 0.5%
const B2C_FEE_MIN_KES = new Decimal(30);
const B2C_FEE_MAX_KES = new Decimal(500);

export interface PayoutQuote {
  grossKes: Decimal; // Amount the chama deducts from its pool
  feeKes: Decimal;   // Platform fee charged to chama
  netKes: Decimal;   // What the recipient actually receives via M-Pesa
  feeRatePct: number; // For UI display ("0.5%")
}

/**
 * Pure calculator — no I/O. Useful for synchronous quote calls.
 */
export function computePayoutFee(amountKes: Decimal | string | number): PayoutQuote {
  const gross = amountKes instanceof Decimal ? amountKes : new Decimal(amountKes);
  if (gross.lte(0)) {
    return {
      grossKes: gross,
      feeKes: new Decimal(0),
      netKes: gross,
      feeRatePct: 0.5,
    };
  }
  let fee = gross.times(B2C_FEE_RATE);
  if (fee.lt(B2C_FEE_MIN_KES)) fee = B2C_FEE_MIN_KES;
  if (fee.gt(B2C_FEE_MAX_KES)) fee = B2C_FEE_MAX_KES;
  // Cap fee at the gross amount so the recipient never sees a negative net.
  if (fee.gt(gross)) fee = gross;
  return {
    grossKes: gross,
    feeKes: fee,
    netKes: gross.minus(fee),
    feeRatePct: 0.5,
  };
}

/**
 * Post the B2C fee to the ledger BEFORE the actual B2C disburses. If the
 * disbursement subsequently fails, the caller should `ledger.recordReversal`
 * the fee transferId.
 *
 * Returns the ledger transferId so the caller can attach it to the
 * PayoutRequest for traceability + reversal.
 */
export async function postPayoutFee(input: {
  chamaId: string;
  payoutIdempotencyKey: string;
  amountKes: Decimal | string | number;
}): Promise<{ transferId: string; quote: PayoutQuote }> {
  const quote = computePayoutFee(input.amountKes);
  if (quote.feeKes.lte(0)) {
    return { transferId: "no-fee", quote };
  }

  const [chamaPool, feeRevenue] = await Promise.all([
    ledger.getOrCreateChamaPoolWallet(input.chamaId),
    ledger.getOrCreateSystemAccount("platform_fee_revenue"),
  ]);

  const { transferId } = await ledger.postTransfer({
    idempotencyKey: `b2c-payout-fee:${input.payoutIdempotencyKey}`,
    metadata: {
      kind: "b2c_payout_fee",
      chamaId: input.chamaId,
      payoutKey: input.payoutIdempotencyKey,
      gross: quote.grossKes.toString(),
      fee: quote.feeKes.toString(),
      net: quote.netKes.toString(),
    },
    postings: [
      { accountId: chamaPool.id, debit: quote.feeKes },
      { accountId: feeRevenue.id, credit: quote.feeKes },
    ],
  });

  return { transferId, quote };
}

/**
 * Disclosure helper — returns the fee breakdown for the treasurer's
 * sign-off UI. NEVER call B2C without showing this to the user first.
 */
export function quotePayout(amountKes: Decimal | string | number): PayoutQuote {
  return computePayoutFee(amountKes);
}
