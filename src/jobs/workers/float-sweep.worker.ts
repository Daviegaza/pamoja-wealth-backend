/**
 * Float sweep worker.
 *
 * Daily cron (03:30). Snapshots platform revenue balances across every
 * fee account family:
 *   platform_fee_revenue, platform_fee_contributions, platform_fee_harambee,
 *   platform_fee_loan_origination, platform_fee_withdrawals, platform_fee_b2c_payout,
 *   platform_fee_late_payment, platform_fee_fx_conversion, platform_fee_insurance,
 *   platform_referral_rewards.
 *
 * Writes an audit-log entry (`platform.float.snapshot`) so ops can prove
 * "how much revenue accrued to platform on day X". Actual bank-sweep of
 * physical M-Pesa float remains manual until a treasury bank API lands —
 * this job is the accounting truth-source that treasury reconciles against.
 *
 * Also emits `float:snapshot` WS event to any admin user so a live
 * treasury dashboard can subscribe.
 */
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { balance } from "../../services/ledger.service.js";

const FEE_ACCOUNT_TYPES = [
  "platform_fee_revenue",
  "platform_fee_contributions",
  "platform_fee_harambee",
  "platform_fee_loan_origination",
  "platform_fee_withdrawals",
  "platform_fee_b2c_payout",
  "platform_fee_late_payment",
  "platform_fee_fx_conversion",
  "platform_fee_insurance",
  "platform_referral_rewards",
];

export interface FloatSnapshot {
  takenAt: string;
  totalKes: number;
  perAccount: Array<{ type: string; balanceKes: number }>;
}

export async function runFloatSweep(): Promise<FloatSnapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const accounts = (await db.ledgerAccount.findMany({
    where: {
      type: { in: FEE_ACCOUNT_TYPES },
      currency: "KES",
    },
    select: { id: true, type: true },
  })) as Array<{ id: string; type: string }>;

  const perAccountRaw: Array<{ type: string; balanceKes: number }> = [];
  let totalKes = 0;
  for (const a of accounts) {
    const b = await balance(a.id);
    const n = Number(b.toString());
    if (!Number.isFinite(n)) continue;
    perAccountRaw.push({ type: a.type, balanceKes: n });
    totalKes += n;
  }

  // Merge duplicate types (multiple accounts per type may exist across currencies).
  const grouped = new Map<string, number>();
  for (const row of perAccountRaw) {
    grouped.set(row.type, (grouped.get(row.type) ?? 0) + row.balanceKes);
  }
  const perAccount = [...grouped.entries()].map(([type, balanceKes]) => ({ type, balanceKes }));

  const snapshot: FloatSnapshot = {
    takenAt: new Date().toISOString(),
    totalKes,
    perAccount,
  };

  await db.auditLog.create({
    data: {
      action: "platform.float.snapshot",
      entity: "ledger",
      entityId: null,
      metadata: snapshot as unknown as object,
    },
  });

  logger.info({ totalKes, accounts: perAccount.length }, "float-sweep: snapshot taken");
  return snapshot;
}
