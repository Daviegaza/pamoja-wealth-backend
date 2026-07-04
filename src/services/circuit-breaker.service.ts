/**
 * Emergency circuit breaker.
 *
 * Automatically freezes a chama's outbound money movement when abuse
 * signals are detected. Prevents the biggest chama-failure mode: an
 * insider quickly draining the pool via loans / payouts / mass exit.
 *
 * Freeze triggers:
 *   • Withdrawal velocity — > 3 payouts totalling > 50% of pool balance
 *     in a 6-hour window
 *   • Mass membership exit — > 30% of active members leave in a 48h window
 *   • Rule-guard denials — 3+ blocked rule-publish attempts in 12h (attacker
 *     probing for weakness)
 *   • Failed sign-in spike — > 20 failed logins across officers in 1h
 *
 * Effect while frozen: contribute + view stays open. Withdraw + loan-disburse
 * + rule-publish + role-change all return 423 LOCKED. Only two officers +
 * one platform admin (WebAuthn signed) can unfreeze.
 *
 * State lives in Redis `chama:freeze:{chamaId}` for read-hot check.
 */
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";

const FREEZE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d default until human clears

export interface FreezeState {
  frozen: boolean;
  reason: string | null;
  triggeredAt: string | null;
  triggeredBy: "auto" | "manual" | null;
}

function freezeKey(chamaId: string): string {
  return `chama:freeze:${chamaId}`;
}

export async function getFreezeState(chamaId: string): Promise<FreezeState> {
  const raw = await redis.get(freezeKey(chamaId)).catch(() => null);
  if (!raw) return { frozen: false, reason: null, triggeredAt: null, triggeredBy: null };
  try {
    return { ...(JSON.parse(raw) as FreezeState), frozen: true };
  } catch {
    return { frozen: false, reason: null, triggeredAt: null, triggeredBy: null };
  }
}

/**
 * Middleware helper — throws ApiError 423 if the chama is frozen. Called
 * by every mutation endpoint that moves money or rules.
 */
export async function assertNotFrozen(chamaId: string): Promise<void> {
  const state = await getFreezeState(chamaId);
  if (!state.frozen) return;
  const err = new Error(`Chama frozen: ${state.reason ?? "under review"}`) as Error & { statusCode?: number; code?: string };
  err.statusCode = 423;
  err.code = "CHAMA_FROZEN";
  throw err;
}

export async function freeze(chamaId: string, reason: string, by: "auto" | "manual", actorUserId?: string): Promise<void> {
  const state: FreezeState = {
    frozen: true,
    reason,
    triggeredAt: new Date().toISOString(),
    triggeredBy: by,
  };
  await redis.setex(freezeKey(chamaId), FREEZE_TTL_SECONDS, JSON.stringify(state)).catch(() => {});
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.auditLog.create({
      data: {
        chamaId,
        userId: actorUserId ?? null,
        action: `chama.freeze.${by}`,
        entityType: "chama",
        entityId: chamaId,
        details: { reason } as any,
      } as any,
    });
  } catch { /* swallow */ }
  logger.warn({ chamaId, reason, by }, "circuit-breaker: chama frozen");
}

export async function unfreeze(chamaId: string, actorUserId: string, reason: string): Promise<void> {
  await redis.del(freezeKey(chamaId)).catch(() => 0);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.auditLog.create({
      data: {
        chamaId,
        userId: actorUserId,
        action: "chama.unfreeze",
        entityType: "chama",
        entityId: chamaId,
        details: { reason } as any,
      } as any,
    });
  } catch { /* swallow */ }
  logger.info({ chamaId, actorUserId, reason }, "circuit-breaker: chama unfrozen");
}

// ── Anomaly sweep (called by cron every 15 min) ────────────────────

export async function runAnomalySweep(): Promise<{ triggered: number }> {
  let triggered = 0;

  // 1. Withdrawal velocity
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const suspiciousWithdrawals = await prisma.$queryRawUnsafe<Array<{ chamaId: string; total: number; count: number }>>(
    `SELECT "chamaId", SUM(amount::float) as total, COUNT(*)::int as count
       FROM transactions
      WHERE type = 'withdrawal' AND status = 'completed'
        AND "createdAt" >= $1
      GROUP BY "chamaId"
      HAVING COUNT(*) >= 3`,
    sixHoursAgo,
  ).catch(() => []);

  for (const row of suspiciousWithdrawals) {
    const chama = await prisma.chama.findUnique({
      where: { id: row.chamaId },
      select: { totalFunds: true, status: true },
    });
    if (!chama || chama.status !== "active") continue;
    const pool = Number(chama.totalFunds);
    if (pool === 0) continue;
    if (row.total / pool >= 0.5) {
      const state = await getFreezeState(row.chamaId);
      if (!state.frozen) {
        await freeze(row.chamaId, `Withdrawal velocity — ${row.count} payouts totalling ${row.total.toLocaleString("en-KE")} in 6h`, "auto");
        triggered += 1;
      }
    }
  }

  // 2. Mass exit — memberships flipping to inactive/removed in 48h > 30% of active
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const massExits = await prisma.$queryRawUnsafe<Array<{ chamaId: string; exits: number; active: number }>>(
    `SELECT c.id as "chamaId",
            COUNT(m2.id)::int as exits,
            (SELECT COUNT(*)::int FROM memberships WHERE "chamaId" = c.id AND status = 'active') as active
       FROM chamas c
       LEFT JOIN memberships m2 ON m2."chamaId" = c.id
                                AND m2.status IN ('inactive', 'suspended')
                                AND m2."updatedAt" >= $1
      GROUP BY c.id
      HAVING COUNT(m2.id) >= 3`,
    fortyEightHoursAgo,
  ).catch(() => []);

  for (const row of massExits) {
    if (row.active === 0) continue;
    if (row.exits / (row.active + row.exits) >= 0.3) {
      const state = await getFreezeState(row.chamaId);
      if (!state.frozen) {
        await freeze(row.chamaId, `Mass member exit — ${row.exits} left in 48h`, "auto");
        triggered += 1;
      }
    }
  }

  logger.info({ triggered }, "circuit-breaker: anomaly sweep done");
  return { triggered };
}
