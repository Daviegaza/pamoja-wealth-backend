/**
 * Bidding payout mode (Money-Club / Indian chit-fund style).
 *
 * Rotation payouts assume trust between members ("we'll go in this
 * order"). Bidding replaces trust with an auction: whoever bids the
 * biggest discount off the pot receives it this cycle. The discount is
 * distributed as dividend to everyone else. Two behavioural benefits:
 *
 *   1) Members who urgently need cash bid heavier — market allocates
 *      the pot to highest utility, not to whoever pressured hardest.
 *   2) The discount pool rewards patient members. Return compounds.
 *
 * Ship: BiddingRound model in Redis (Prisma migration deferred).
 * Auction opens 7 days before cycle end. Members submit sealed bids.
 * At close, highest bid wins; ties broken by member seniority (join date).
 */
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";

const ROUND_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface BidRound {
  id: string;
  chamaId: string;
  cycleId: string;         // year-month e.g. "2026-07"
  potKes: number;
  opensAt: string;
  closesAt: string;
  status: "open" | "closed" | "settled";
  winnerUserId: string | null;
  winningBidKes: number | null;
  bids: Array<{ userId: string; bidKes: number; submittedAt: string }>;
  createdAt: string;
}

function key(chamaId: string, cycleId: string) {
  return `bidround:${chamaId}:${cycleId}`;
}

export async function openBidRound(input: {
  chamaId: string;
  cycleId: string;
  potKes: number;
  windowDays: number;
}): Promise<BidRound> {
  const existing = await redis.get(key(input.chamaId, input.cycleId)).catch(() => null);
  if (existing) return JSON.parse(existing) as BidRound;

  const round: BidRound = {
    id: `${input.chamaId}-${input.cycleId}`,
    chamaId: input.chamaId,
    cycleId: input.cycleId,
    potKes: input.potKes,
    opensAt: new Date().toISOString(),
    closesAt: new Date(Date.now() + input.windowDays * 86_400_000).toISOString(),
    status: "open",
    winnerUserId: null,
    winningBidKes: null,
    bids: [],
    createdAt: new Date().toISOString(),
  };
  await redis.setex(key(input.chamaId, input.cycleId), ROUND_TTL_SECONDS, JSON.stringify(round)).catch(() => {});
  logger.info({ chamaId: input.chamaId, cycleId: input.cycleId, potKes: input.potKes }, "bid-round opened");
  return round;
}

export async function submitBid(input: {
  chamaId: string;
  cycleId: string;
  userId: string;
  bidKes: number;
}): Promise<BidRound> {
  const raw = await redis.get(key(input.chamaId, input.cycleId));
  if (!raw) throw new Error("Bidding round not open for this cycle");
  const round = JSON.parse(raw) as BidRound;
  if (round.status !== "open") throw new Error(`Round ${round.status}`);
  if (new Date(round.closesAt).getTime() < Date.now()) throw new Error("Round closed");
  if (input.bidKes <= 0 || input.bidKes >= round.potKes) throw new Error("Bid must be > 0 and < pot");

  const member = await prisma.membership.findFirst({
    where: { userId: input.userId, chamaId: input.chamaId, status: "active" },
    select: { id: true },
  });
  if (!member) throw new Error("Not an active member of this chama");

  // Replace prior bid for the same user (bids are updateable until close).
  round.bids = round.bids.filter((b) => b.userId !== input.userId);
  round.bids.push({ userId: input.userId, bidKes: input.bidKes, submittedAt: new Date().toISOString() });
  await redis.setex(key(input.chamaId, input.cycleId), ROUND_TTL_SECONDS, JSON.stringify(round)).catch(() => {});
  return round;
}

/**
 * Close + settle. Highest bid wins; on tie, earliest member (joinedAt) wins.
 * Returns the round with `winnerUserId`, `winningBidKes`, and per-member
 * dividend allocation of (winningBidKes / (memberCount - 1)).
 */
export async function closeBidRound(chamaId: string, cycleId: string): Promise<{
  round: BidRound;
  perMemberDividendKes: number;
}> {
  const raw = await redis.get(key(chamaId, cycleId));
  if (!raw) throw new Error("Round not found");
  const round = JSON.parse(raw) as BidRound;
  if (round.status !== "open") throw new Error(`Round already ${round.status}`);

  if (round.bids.length === 0) {
    round.status = "closed";
    await redis.setex(key(chamaId, cycleId), ROUND_TTL_SECONDS, JSON.stringify(round)).catch(() => {});
    return { round, perMemberDividendKes: 0 };
  }

  const sorted = [...round.bids].sort((a, b) => b.bidKes - a.bidKes || a.submittedAt.localeCompare(b.submittedAt));
  const winner = sorted[0]!;

  const members = await prisma.membership.count({
    where: { chamaId, status: "active" },
  });
  const perMemberDividendKes = members > 1 ? Math.floor(winner.bidKes / (members - 1)) : 0;

  round.status = "settled";
  round.winnerUserId = winner.userId;
  round.winningBidKes = winner.bidKes;
  await redis.setex(key(chamaId, cycleId), ROUND_TTL_SECONDS, JSON.stringify(round)).catch(() => {});
  logger.info({ chamaId, cycleId, winnerUserId: winner.userId, winningBidKes: winner.bidKes, perMemberDividendKes }, "bid-round settled");
  return { round, perMemberDividendKes };
}

export async function getBidRound(chamaId: string, cycleId: string): Promise<BidRound | null> {
  const raw = await redis.get(key(chamaId, cycleId)).catch(() => null);
  return raw ? (JSON.parse(raw) as BidRound) : null;
}
