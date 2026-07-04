/**
 * Impact scoreboard — aggregate metrics for the public landing / marketing
 * pages. Cached for 10 minutes to avoid hammering the ledger on every
 * homepage load.
 */
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";

const CACHE_TTL_SECONDS = 10 * 60;
const CACHE_KEY = "impact:global";

export interface ImpactSnapshot {
  chamasActive: number;
  membersServed: number;
  contributionsKes: number;
  loansIssuedKes: number;
  harambeeRaisedKes: number;
  countries: number;
  computedAt: string;
  cached: boolean;
}

export async function getImpactSnapshot(): Promise<ImpactSnapshot> {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ImpactSnapshot;
      return { ...parsed, cached: true };
    } catch { /* fall through */ }
  }

  const [chamasActive, membersServed, contribAgg, loansAgg, donationsAgg, countriesRaw] = await Promise.all([
    prisma.chama.count({ where: { status: "active" } }),
    prisma.membership.count({ where: { status: "active" } }),
    prisma.transaction.aggregate({
      where: { type: "contribution", status: "completed" },
      _sum: { amount: true },
    }),
    prisma.loan.aggregate({
      where: { status: { in: ["active", "completed"] } },
      _sum: { amount: true },
    }),
    prisma.donation.aggregate({
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: 0 } })),
    prisma.user.findMany({
      where: { location: { not: null } },
      distinct: ["location"],
      select: { location: true },
      take: 500,
    }),
  ]);

  const snapshot: ImpactSnapshot = {
    chamasActive,
    membersServed,
    contributionsKes: Number(contribAgg._sum.amount ?? 0),
    loansIssuedKes: Number(loansAgg._sum.amount ?? 0),
    harambeeRaisedKes: Number(donationsAgg._sum?.amount ?? 0),
    countries: Math.max(1, new Set(countriesRaw.map((c) => (c.location ?? "").split(",").pop()?.trim()).filter(Boolean)).size),
    computedAt: new Date().toISOString(),
    cached: false,
  };

  await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(snapshot)).catch(() => {});
  return snapshot;
}
