/**
 * Trust Score — ledger-derived portable credit passport for chama members.
 *
 * Range: 300 (new / no history) to 950 (elite).
 * Formula (v1, weighted mix of behavioural + identity signals):
 *   - Contribution streak (max 24 mo)                  × 8
 *   - On-time repayment rate (0..1)                    × 200
 *   - KYC tier (0..3)                                  × 40
 *   - Chamas actively participated in (max 8)          × 15
 *   - Years on platform (capped at 5)                  × 20
 *   - Reputation seed 300
 *   - Penalty: −60 per suspicious-transaction report
 *   - Penalty: −80 per defaulted loan
 *
 * Cached in Redis for 5 minutes per user. Portable / shareable via the
 * /trust-score/:userId endpoint (user must be authenticated; reveals only
 * scalar score + tier for non-self lookups).
 */
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";

const CACHE_TTL_SECONDS = 300;
const SCORE_FLOOR = 300;
const SCORE_CEILING = 950;

export interface TrustScoreBreakdown {
  contributionStreakMonths: number;
  onTimePaymentRate: number;
  disputeCount: number;
  defaultedLoanCount: number;
  kycTier: number;
  chamasActive: number;
  yearsOnPlatform: number;
}

export interface TrustScoreResult {
  userId: string;
  score: number;
  band: "new" | "building" | "fair" | "strong" | "elite";
  breakdown: TrustScoreBreakdown;
  computedAt: string;
  cached: boolean;
}

function bandFor(score: number): TrustScoreResult["band"] {
  if (score >= 850) return "elite";
  if (score >= 700) return "strong";
  if (score >= 550) return "fair";
  if (score >= 400) return "building";
  return "new";
}

function cacheKey(userId: string): string {
  return `trust-score:${userId}`;
}

export async function getTrustScore(userId: string, opts: { skipCache?: boolean } = {}): Promise<TrustScoreResult> {
  if (!opts.skipCache) {
    const cached = await redis.get(cacheKey(userId)).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as TrustScoreResult;
        return { ...parsed, cached: true };
      } catch {
        // fall through to recompute
      }
    }
  }

  const [user, memberships, loans, disputes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true, kycTier: true, isVerified: true },
    }),
    prisma.membership.findMany({
      where: { userId, status: "active" },
      select: { id: true, contributionStreak: true, chamaId: true },
    }),
    prisma.loan.findMany({
      where: { borrowerId: userId },
      select: { id: true, status: true, amount: true, amountRepaid: true, dueDate: true, appliedDate: true },
    }),
    prisma.suspiciousTransactionReport.count({
      where: { subjectUserId: userId, status: { in: ["open", "submitted"] } },
    }),
  ]);

  if (!user) {
    throw new Error(`user ${userId} not found`);
  }

  const contributionStreakMonths = memberships.reduce((max, m) => Math.max(max, m.contributionStreak), 0);
  const chamasActive = memberships.length;
  const yearsOnPlatform = Math.max(0, (Date.now() - user.createdAt.getTime()) / (365 * 24 * 60 * 60 * 1000));
  const kycTier = Math.min(3, user.kycTier ?? (user.isVerified ? 2 : 1));

  const completedLoans = loans.filter((l) => l.status === "completed" || l.status === "active");
  const defaultedLoanCount = loans.filter((l) => l.status === "defaulted").length;

  let onTimePaymentRate = 1;
  if (completedLoans.length > 0) {
    // Approx: repaid_ratio averaged across loans, discounted if any past-due.
    const now = Date.now();
    const perLoan = completedLoans.map((l) => {
      const amount = Number(l.amount);
      const paid = Number(l.amountRepaid);
      const repaidRatio = amount > 0 ? Math.min(1, paid / amount) : 1;
      const overdue = l.status === "active" && l.dueDate.getTime() < now && paid < amount;
      return overdue ? Math.max(0, repaidRatio - 0.3) : repaidRatio;
    });
    onTimePaymentRate = perLoan.reduce((s, x) => s + x, 0) / perLoan.length;
  }

  const raw =
    SCORE_FLOOR +
    Math.min(contributionStreakMonths, 24) * 8 +
    onTimePaymentRate * 200 +
    kycTier * 40 +
    Math.min(chamasActive, 8) * 15 +
    Math.min(yearsOnPlatform, 5) * 20 -
    disputes * 60 -
    defaultedLoanCount * 80;

  const score = Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, Math.round(raw)));

  const result: TrustScoreResult = {
    userId,
    score,
    band: bandFor(score),
    breakdown: {
      contributionStreakMonths,
      onTimePaymentRate: Math.round(onTimePaymentRate * 1000) / 1000,
      disputeCount: disputes,
      defaultedLoanCount,
      kycTier,
      chamasActive,
      yearsOnPlatform: Math.round(yearsOnPlatform * 10) / 10,
    },
    computedAt: new Date().toISOString(),
    cached: false,
  };

  await redis.setex(cacheKey(userId), CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {
    // Redis outage: return uncached; endpoint stays available.
  });

  return result;
}

export async function invalidateTrustScore(userId: string): Promise<void> {
  await redis.del(cacheKey(userId)).catch(() => {});
}

/**
 * Public projection — for lookups of *other* users. Reveals only the
 * band and score, hides breakdown detail. Used by SACCO / lender / insurer
 * partners who query trust of prospects.
 */
export interface TrustScorePublic {
  userId: string;
  score: number;
  band: TrustScoreResult["band"];
  computedAt: string;
}

export function toPublic(r: TrustScoreResult): TrustScorePublic {
  return { userId: r.userId, score: r.score, band: r.band, computedAt: r.computedAt };
}
