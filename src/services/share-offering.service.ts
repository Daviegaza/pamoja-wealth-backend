/**
 * Share offerings + cap table.
 *
 * A chama (or fundraiser structured as an equity round) can create a
 * ShareOffering: totalShares, pricePerShareKes, terms, closing date. Investors
 * buy in via a shareable link — they enter amount, we allocate shares
 * (amountKes / pricePerShare) and record a ShareHolding. Cap table computes
 * percentages live.
 *
 * When the chama declares a dividend (total pot ÷ shares), each holder's
 * cut = shares_held / total_shares_issued × dividend_pot.
 *
 * Redis-backed until a Prisma migration lands. Values are canonical KES.
 */
import { redis } from "../config/redis.js";
import crypto from "crypto";
import { logger } from "../config/logger.js";
import { prisma } from "../config/database.js";
import { dividendPayoutQueue } from "../jobs/queue.js";

export interface ShareOffering {
  id: string;
  chamaId: string;
  createdById: string;
  createdAt: string;
  title: string;
  description?: string;
  totalShares: number;
  pricePerShareKes: number;
  minInvestmentKes?: number;
  maxInvestmentKes?: number;
  closesAt?: string;
  terms?: string; // free-text summary — link out to full docs
  sharesSold: number;
  status: "open" | "closed" | "cancelled";
}

export interface ShareHolding {
  id: string;
  offeringId: string;
  chamaId: string;
  investorUserId?: string; // null = anonymous investor
  investorName?: string;
  investorPhone?: string;
  investorEmail?: string;
  amountKes: number;
  shares: number;
  reference: string;
  status: "pending" | "confirmed" | "refunded";
  createdAt: string;
}

const offKey = (id: string) => `offering:${id}`;
const chamaOffIdx = (chamaId: string) => `offering:chama:${chamaId}`;
const holdKey = (id: string) => `holding:${id}`;
const offHoldIdx = (offeringId: string) => `holding:offering:${offeringId}`;
const chamaHoldIdx = (chamaId: string) => `holding:chama:${chamaId}`;

export async function createOffering(input: Omit<ShareOffering, "id" | "createdAt" | "sharesSold" | "status">): Promise<ShareOffering> {
  const id = crypto.randomBytes(9).toString("base64url");
  const offering: ShareOffering = {
    ...input,
    id,
    sharesSold: 0,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  await redis.set(offKey(id), JSON.stringify(offering));
  await redis.sadd(chamaOffIdx(input.chamaId), id);
  logger.info({ id, chamaId: input.chamaId }, "share offering created");
  return offering;
}

export async function getOffering(id: string): Promise<ShareOffering | null> {
  const raw = await redis.get(offKey(id));
  return raw ? (JSON.parse(raw) as ShareOffering) : null;
}

export async function listOfferings(chamaId: string): Promise<ShareOffering[]> {
  const ids = await redis.smembers(chamaOffIdx(chamaId));
  const out: ShareOffering[] = [];
  for (const id of ids) {
    const o = await getOffering(id);
    if (o) out.push(o);
  }
  return out;
}

export async function closeOffering(id: string): Promise<void> {
  const o = await getOffering(id);
  if (!o) return;
  o.status = "closed";
  await redis.set(offKey(id), JSON.stringify(o));
}

/**
 * Allocate shares from an amount. Rounded down to whole shares — leftover KES
 * is stored on the holding as `changeKes` in future iterations.
 */
export async function invest(input: {
  offeringId: string;
  amountKes: number;
  investorUserId?: string;
  investorName?: string;
  investorPhone?: string;
  investorEmail?: string;
  reference: string;
}): Promise<ShareHolding> {
  const offering = await getOffering(input.offeringId);
  if (!offering) throw new Error("offering not found");
  if (offering.status !== "open") throw new Error("offering closed");
  if (offering.minInvestmentKes && input.amountKes < offering.minInvestmentKes) {
    throw new Error(`minimum investment KES ${offering.minInvestmentKes}`);
  }
  if (offering.maxInvestmentKes && input.amountKes > offering.maxInvestmentKes) {
    throw new Error(`maximum investment KES ${offering.maxInvestmentKes}`);
  }
  const shares = Math.floor(input.amountKes / offering.pricePerShareKes);
  const available = offering.totalShares - offering.sharesSold;
  if (shares > available) {
    throw new Error(`only ${available} shares left`);
  }

  const id = crypto.randomBytes(12).toString("hex");
  const holding: ShareHolding = {
    id,
    offeringId: offering.id,
    chamaId: offering.chamaId,
    investorUserId: input.investorUserId,
    investorName: input.investorName,
    investorPhone: input.investorPhone,
    investorEmail: input.investorEmail,
    amountKes: input.amountKes,
    shares,
    reference: input.reference,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await redis.set(holdKey(id), JSON.stringify(holding));
  await redis.sadd(offHoldIdx(offering.id), id);
  await redis.sadd(chamaHoldIdx(offering.chamaId), id);
  return holding;
}

export async function confirmHolding(id: string): Promise<void> {
  const raw = await redis.get(holdKey(id));
  if (!raw) return;
  const holding = JSON.parse(raw) as ShareHolding;
  holding.status = "confirmed";
  await redis.set(holdKey(id), JSON.stringify(holding));

  const offering = await getOffering(holding.offeringId);
  if (offering) {
    offering.sharesSold += holding.shares;
    if (offering.sharesSold >= offering.totalShares) offering.status = "closed";
    await redis.set(offKey(offering.id), JSON.stringify(offering));
  }
}

export interface CapTableRow {
  investor: string;
  investorUserId?: string;
  shares: number;
  amountKes: number;
  percent: number;
}

export async function capTable(chamaId: string): Promise<{ totalShares: number; totalRaisedKes: number; rows: CapTableRow[] }> {
  const ids = await redis.smembers(chamaHoldIdx(chamaId));
  const byInvestor = new Map<string, CapTableRow>();
  let totalShares = 0;
  let totalRaisedKes = 0;
  for (const id of ids) {
    const raw = await redis.get(holdKey(id));
    if (!raw) continue;
    const h = JSON.parse(raw) as ShareHolding;
    if (h.status !== "confirmed") continue;
    const key = h.investorUserId ?? h.investorEmail ?? h.investorPhone ?? h.investorName ?? "anon";
    const label = h.investorName ?? h.investorEmail ?? h.investorPhone ?? "Anonymous";
    const existing = byInvestor.get(key) ?? {
      investor: label, investorUserId: h.investorUserId, shares: 0, amountKes: 0, percent: 0,
    };
    existing.shares += h.shares;
    existing.amountKes += h.amountKes;
    byInvestor.set(key, existing);
    totalShares += h.shares;
    totalRaisedKes += h.amountKes;
  }
  const rows = [...byInvestor.values()]
    .map((r) => ({ ...r, percent: totalShares > 0 ? Math.round((r.shares / totalShares) * 10000) / 100 : 0 }))
    .sort((a, b) => b.shares - a.shares);
  return { totalShares, totalRaisedKes, rows };
}

/**
 * Declare a dividend for a chama — distributes `potKes` across confirmed
 * holders pro-rata. Returns per-holder allocation for downstream payout.
 */
export async function declareDividend(chamaId: string, potKes: number): Promise<{
  distributed: Array<{ investorUserId?: string; investorPhone?: string; investorEmail?: string; amountKes: number; percent: number }>;
  totalKes: number;
}> {
  const cap = await capTable(chamaId);
  if (cap.totalShares === 0) return { distributed: [], totalKes: 0 };
  const distributed = cap.rows.map((r) => ({
    investorUserId: r.investorUserId,
    investorPhone: undefined,
    investorEmail: undefined,
    amountKes: Math.round((r.shares / cap.totalShares) * potKes * 100) / 100,
    percent: r.percent,
  }));
  return { distributed, totalKes: potKes };
}

/**
 * Execute a dividend distribution end-to-end.
 *
 * 1. Compute pro-rata split (same as `declareDividend`).
 * 2. Filter to holders with a userId (anonymous holders are skipped — they
 *    must be paid manually or claim via link).
 * 3. Create one PayoutRequest per holder with idempotencyKey =
 *    `dividend:{chamaId}:{initiatorUserId}:{recipientUserId}:{ts}`.
 * 4. Enqueue a `dividend-payout` job per PayoutRequest.
 *
 * Multi-sig: PayoutRequest is created in `status="pending"`; if
 * `requiredSignatures > 1`, downstream signature collection blocks the
 * worker from disbursing. For MVP we default to a single-sig chama config,
 * so the worker fires immediately.
 *
 * Returns the PayoutRequest IDs so the initiator can track them.
 */
export async function executeDividend(input: {
  chamaId: string;
  potKes: number;
  initiatorUserId: string;
  requiredSignatures?: number;
}): Promise<{ enqueued: number; skipped: number; totalKes: number; payoutIds: string[] }> {
  const preview = await declareDividend(input.chamaId, input.potKes);
  const requiredSignatures = input.requiredSignatures ?? 1;
  const ts = Date.now();
  const payoutIds: string[] = [];
  let enqueued = 0;
  let skipped = 0;
  let totalKes = 0;

  for (const row of preview.distributed) {
    if (!row.investorUserId) { skipped += 1; continue; }
    if (row.amountKes <= 0) { skipped += 1; continue; }

    const idempotencyKey = `dividend:${input.chamaId}:${input.initiatorUserId}:${row.investorUserId}:${ts}`;
    const payout = await prisma.payoutRequest.create({
      data: {
        chamaId: input.chamaId,
        recipientUserId: row.investorUserId,
        amount: row.amountKes,
        currency: "KES",
        purpose: "dividend",
        requiredSignatures,
        status: requiredSignatures > 1 ? "awaiting_signatures" : "pending",
        idempotencyKey,
        createdById: input.initiatorUserId,
      },
      select: { id: true, status: true },
    });
    payoutIds.push(payout.id);
    totalKes += row.amountKes;

    if (payout.status === "pending") {
      await dividendPayoutQueue.add("dividend-payout", { payoutRequestId: payout.id });
      enqueued += 1;
    }
  }

  logger.info({ chamaId: input.chamaId, enqueued, skipped, totalKes }, "executeDividend");
  return { enqueued, skipped, totalKes, payoutIds };
}
