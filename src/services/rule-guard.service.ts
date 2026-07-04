/**
 * Trust guard for chama rule changes.
 *
 * Bylaws are load-bearing — anyone who can freely rewrite them can drain
 * a chama. Guards below layer defence-in-depth around every publish:
 *
 *   1) ROLE  — only owner / admin / treasurer / chairperson can propose.
 *   2) COOLDOWN — one non-emergency change per 30 days per chama (unless
 *      the caller supplies emergency=true AND passes the officer-vote
 *      threshold).
 *   3) SIGNATURES — the request must include approvedByIds covering at
 *      least CEIL(officers*2/3) distinct active officers.
 *   4) SELF-APPROVAL — the initiator counts as 1 signature, no need to
 *      double-count.
 *   5) HASH CHAIN — publishRuleVersion already writes ChamaRule with
 *      prevHash/hash. Tampering with older rows breaks the chain.
 *   6) AUDIT LOG — every attempt (allowed or denied) writes to AuditLog.
 *
 * Emergency override: pass `emergency=true` with a written reason. The
 * cooldown is skipped but the signature threshold rises to CEIL(officers).
 */
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { logger } from "../config/logger.js";

const COOLDOWN_DAYS = 30;
const NORMAL_SIG_RATIO = 2 / 3;
const EMERGENCY_SIG_RATIO = 1.0;

const OFFICER_ROLES = ["owner", "admin", "treasurer", "chairperson"] as const;

export interface GuardInput {
  chamaId: string;
  initiatorUserId: string;
  approvedByIds: string[];
  emergency?: boolean;
  reason?: string;
}

export interface GuardVerdict {
  allowed: boolean;
  officerCount: number;
  requiredSignatures: number;
  collectedSignatures: number;
  cooldownEndsAt: string | null;
  reason?: string;
}

export async function guardRulePublish(input: GuardInput): Promise<GuardVerdict> {
  const { chamaId, initiatorUserId, approvedByIds } = input;

  // 1. Initiator must be an officer.
  const membership = await prisma.membership.findFirst({
    where: {
      userId: initiatorUserId,
      chamaId,
      status: "active",
      role: { in: [...OFFICER_ROLES] },
    },
  });
  if (!membership) {
    await audit(chamaId, initiatorUserId, "denied.role");
    throw ApiError.forbidden("Only chama officers can propose bylaw changes.");
  }

  // 2. Cooldown check — most recent successful publish.
  const latest = await prisma.chamaRule.findFirst({
    where: { chamaId },
    orderBy: { version: "desc" },
    select: { effectiveAt: true, version: true },
  });
  const cooldownEndsAt =
    latest != null
      ? new Date(latest.effectiveAt.getTime() + COOLDOWN_DAYS * 86_400_000)
      : null;
  const inCooldown = cooldownEndsAt != null && cooldownEndsAt > new Date();

  if (inCooldown && !input.emergency) {
    await audit(chamaId, initiatorUserId, "denied.cooldown");
    const days = Math.ceil((cooldownEndsAt.getTime() - Date.now()) / 86_400_000);
    throw ApiError.validation(
      `Bylaws were changed recently — next non-emergency change allowed in ${days} day${days === 1 ? "" : "s"}. ` +
      `Pass emergency=true with a written reason to override.`,
    );
  }
  if (input.emergency && !input.reason) {
    await audit(chamaId, initiatorUserId, "denied.emergency_no_reason");
    throw ApiError.validation("Emergency bylaw change requires a written reason.");
  }

  // 3. Signature threshold.
  const officers = await prisma.membership.findMany({
    where: {
      chamaId,
      status: "active",
      role: { in: [...OFFICER_ROLES] },
    },
    select: { userId: true },
  });
  const officerCount = officers.length;
  const officerIds = new Set(officers.map((o) => o.userId));
  const ratio = input.emergency ? EMERGENCY_SIG_RATIO : NORMAL_SIG_RATIO;
  const required = Math.max(1, Math.ceil(officerCount * ratio));

  // De-dupe + count only actual officers. Initiator auto-counts.
  const signers = new Set<string>([initiatorUserId, ...approvedByIds]);
  const validSignatures = [...signers].filter((id) => officerIds.has(id)).length;

  if (validSignatures < required) {
    await audit(chamaId, initiatorUserId, "denied.signatures", {
      required,
      collected: validSignatures,
    });
    throw ApiError.validation(
      `Bylaw change needs ${required} officer signatures — currently ${validSignatures}. ` +
      `Ask remaining officers to co-sign the proposal.`,
    );
  }

  // Allowed. Caller proceeds to publishRuleVersion.
  await audit(chamaId, initiatorUserId, "allowed", { required, collected: validSignatures, emergency: !!input.emergency });
  logger.info({ chamaId, initiatorUserId, required, validSignatures, emergency: !!input.emergency }, "rule-guard: allowed");

  return {
    allowed: true,
    officerCount,
    requiredSignatures: required,
    collectedSignatures: validSignatures,
    cooldownEndsAt: cooldownEndsAt?.toISOString() ?? null,
  };
}

/**
 * Read-only snapshot used by the frontend to render permission + cooldown
 * state on the Rule Builder page (so the Save button can be disabled with
 * a specific reason before the user wastes effort).
 */
export async function getRuleGuardStatus(chamaId: string, userId: string): Promise<{
  isOfficer: boolean;
  officerCount: number;
  requiredSignatures: number;
  cooldownEndsAt: string | null;
  inCooldown: boolean;
}> {
  const [me, officers, latest] = await Promise.all([
    prisma.membership.findFirst({
      where: { userId, chamaId, status: "active", role: { in: [...OFFICER_ROLES] } },
      select: { id: true },
    }),
    prisma.membership.findMany({
      where: { chamaId, status: "active", role: { in: [...OFFICER_ROLES] } },
      select: { userId: true },
    }),
    prisma.chamaRule.findFirst({
      where: { chamaId },
      orderBy: { version: "desc" },
      select: { effectiveAt: true },
    }),
  ]);

  const officerCount = officers.length;
  const requiredSignatures = Math.max(1, Math.ceil(officerCount * NORMAL_SIG_RATIO));
  const cooldownEndsAt = latest != null
    ? new Date(latest.effectiveAt.getTime() + COOLDOWN_DAYS * 86_400_000)
    : null;
  const inCooldown = cooldownEndsAt != null && cooldownEndsAt > new Date();

  return {
    isOfficer: me != null,
    officerCount,
    requiredSignatures,
    cooldownEndsAt: cooldownEndsAt?.toISOString() ?? null,
    inCooldown,
  };
}

async function audit(chamaId: string, userId: string, action: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.auditLog.create({
      data: {
        chamaId,
        userId,
        action: `rule.publish.${action}`,
        entityType: "chama_rule",
        entityId: chamaId,
        ...(meta ? { details: meta as any } : {}),
      } as any,
    });
  } catch (err) {
    logger.warn({ err, chamaId, userId, action }, "rule-guard: audit write failed");
  }
}
