// Rule Engine — see RESEARCH_DOSSIER §6.10 (AI Rule-Engine Compiler) + §7.18
// (multi-tenant rule engine storage).
//
// This module:
//   - exposes the typed `RuleDoc` shape (mirroring frontend types verbatim);
//   - reads the active rule version for a chama;
//   - publishes a new version using a hash-chained version chain;
//   - evaluates per-hook contexts against the active rules.
//
// Evaluation is intentionally pure & side-effect-free except for DB reads.
// Wallet/loan/vote services call `evaluate(...)` and surface violations as
// `ApiError.unprocessable(violations)` — but enforcement is gated by the
// FEATURE_RULE_ENGINE_ENFORCE flag for a phased rollout (dossier §7.7).

import crypto from "crypto";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";

// ─── Types — MUST match the frontend RuleDoc shape ───────────────────
// (Source of truth: /home/davie/WebstormProjects/pamoja-wealth/src/types/index.ts)

export interface ContributionRule {
  amountKes: number;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  dueDay: number; // 1-31 for monthly, 1-7 for weekly (Mon=1)
  graceDays: number;
}

export interface EligibilityRule {
  minAge?: number;
  maxAge?: number;
  genders?: ("male" | "female" | "any")[];
  location?: string;
  employer?: string;
  custom?: string;
}

export interface VettingRule {
  sponsorRequired: boolean;
  sponsorCount: number;
  voteThresholdPct: number; // 0-100
  manualReviewByRoles: string[];
}

export interface VotingRule {
  quorumPct: number;
  passThresholdPct: number;
  weightedByContribution: boolean;
  weightedByTenureMonths: boolean;
}

export interface PayoutOrder {
  mode: "rotational" | "by_need" | "by_vote" | "lump_sum_at_term";
  rotationSeed?: string[];
}

export interface ExitRule {
  trigger: {
    missedContributions?: number;
    window?: "rolling-6m" | "rolling-12m" | "absolute";
    manual?: boolean;
  };
  penalty: {
    forfeitEntryBond?: boolean;
    forfeitPctOfShares?: number;
    refundDelayDays?: number;
  };
  proRated: boolean;
}

export interface DividendRule {
  policy: "equal" | "by_shares" | "by_contribution" | "by_tenure" | "reinvest";
  payoutCadence: "monthly" | "quarterly" | "annual" | "at_term";
}

export interface EntryDepositRule {
  amountKes: number;
  refundableOnExit: boolean;
  payableIn: number;
}

export interface RuleDoc {
  version: number;
  entryDeposit?: EntryDepositRule;
  contribution: ContributionRule;
  eligibility?: EligibilityRule;
  vetting?: VettingRule;
  voting: VotingRule;
  payoutOrder?: PayoutOrder;
  exit?: ExitRule;
  dividend?: DividendRule;
  custom?: Record<string, unknown>;
}

// ─── Hook plumbing ───────────────────────────────────────────────────

export type HookPoint =
  | "member_apply"
  | "contribution_received"
  | "loan_request"
  | "vote_cast"
  | "exit_request"
  | "payout_initiate";

export interface HookContext {
  [k: string]: unknown;
}

export interface RuleViolation {
  code: string;
  message: string;
  hint?: string;
}

export interface EvaluationResult {
  allowed: boolean;
  violations: RuleViolation[];
}

// Feature flag — when "true", violations throw and block the operation.
// Default false: evaluator runs in shadow mode (warns only) so we can
// observe in production before enforcing (dossier §7.7).
export function isEnforcementEnabled(): boolean {
  return process.env.FEATURE_RULE_ENGINE_ENFORCE === "true";
}

// ─── Active rule lookup ──────────────────────────────────────────────

export async function activeRule(chamaId: string): Promise<RuleDoc | null> {
  const row = await prisma.chamaRule.findFirst({
    where: { chamaId, supersededAt: null },
    orderBy: { version: "desc" },
  });
  if (!row) return null;
  return row.ruleDoc as unknown as RuleDoc;
}

// ─── Hash chain ──────────────────────────────────────────────────────

function computeHash(input: {
  prevHash: Uint8Array | null;
  ruleDoc: RuleDoc;
  createdById: string;
  effectiveAt: Date;
}): Uint8Array<ArrayBuffer> {
  const h = crypto.createHash("sha256");
  if (input.prevHash) h.update(input.prevHash);
  h.update(JSON.stringify(input.ruleDoc));
  h.update(input.createdById);
  h.update(input.effectiveAt.toISOString());
  const digest = h.digest();
  // Force ArrayBuffer-backed Uint8Array (Prisma `Bytes` requires it).
  const ab = new ArrayBuffer(digest.byteLength);
  const out = new Uint8Array(ab);
  out.set(digest);
  return out;
}

// ─── Publish a new rule version ──────────────────────────────────────

export async function publishRuleVersion(input: {
  chamaId: string;
  ruleDoc: RuleDoc;
  sourceText?: string;
  compiledBy: "human" | "claude-sonnet-4-5";
  createdById: string;
  approvedByIds: string[];
}): Promise<{ version: number; hash: string }> {
  const effectiveAt = new Date();

  return prisma.$transaction(async (tx) => {
    // Find the current active version (if any).
    const prior = await tx.chamaRule.findFirst({
      where: { chamaId: input.chamaId, supersededAt: null },
      orderBy: { version: "desc" },
    });

    const nextVersion = prior ? prior.version + 1 : 1;
    const prevHash = prior?.hash ?? null;

    const docToPersist: RuleDoc = { ...input.ruleDoc, version: nextVersion };
    const hash = computeHash({
      prevHash,
      ruleDoc: docToPersist,
      createdById: input.createdById,
      effectiveAt,
    });

    if (prior) {
      await tx.chamaRule.update({
        where: { id: prior.id },
        data: { supersededAt: effectiveAt },
      });
    }

    await tx.chamaRule.create({
      data: {
        chamaId: input.chamaId,
        version: nextVersion,
        ruleDoc: docToPersist as unknown as object,
        sourceText: input.sourceText ?? null,
        compiledBy: input.compiledBy,
        effectiveAt,
        createdById: input.createdById,
        approvedByIds: input.approvedByIds,
        prevHash,
        hash,
      },
    });

    return { version: nextVersion, hash: Buffer.from(hash).toString("hex") };
  });
}

// ─── Evaluator ───────────────────────────────────────────────────────

export async function evaluate(
  point: HookPoint,
  chamaId: string,
  ctx: HookContext
): Promise<EvaluationResult> {
  const rule = await activeRule(chamaId);
  if (!rule) {
    // No published bylaws → allow by default; the rest of the platform's
    // existing checks still apply (membership, balances, etc.).
    return { allowed: true, violations: [] };
  }

  switch (point) {
    case "member_apply":
      return evalMemberApply(rule, ctx);
    case "contribution_received":
      return evalContributionReceived(rule, ctx);
    case "loan_request":
      return evalLoanRequest(rule, ctx);
    case "vote_cast":
      return evalVoteCast(rule, ctx);
    case "exit_request":
      return evalExitRequest(rule, ctx);
    case "payout_initiate":
      return evalPayoutInitiate(rule, chamaId, ctx);
    default:
      return { allowed: true, violations: [] };
  }
}

// ── Per-hook implementations ────────────────────────────────────────

function evalMemberApply(rule: RuleDoc, ctx: HookContext): EvaluationResult {
  const violations: RuleViolation[] = [];

  // Eligibility checks (only what the ctx provides — undefined fields skip).
  if (rule.eligibility) {
    const age = typeof ctx.age === "number" ? (ctx.age as number) : undefined;
    if (rule.eligibility.minAge !== undefined && age !== undefined && age < rule.eligibility.minAge) {
      violations.push({
        code: "ELIGIBILITY_AGE_TOO_LOW",
        message: `Minimum age for this chama is ${rule.eligibility.minAge}`,
      });
    }
    if (rule.eligibility.maxAge !== undefined && age !== undefined && age > rule.eligibility.maxAge) {
      violations.push({
        code: "ELIGIBILITY_AGE_TOO_HIGH",
        message: `Maximum age for this chama is ${rule.eligibility.maxAge}`,
      });
    }
    if (rule.eligibility.genders && rule.eligibility.genders.length > 0) {
      const allowsAny = rule.eligibility.genders.includes("any");
      const gender = ctx.gender as string | undefined;
      if (!allowsAny && gender && !rule.eligibility.genders.includes(gender as "male" | "female")) {
        violations.push({
          code: "ELIGIBILITY_GENDER_NOT_ALLOWED",
          message: `This chama is restricted to: ${rule.eligibility.genders.join(", ")}`,
        });
      }
    }
    if (rule.eligibility.location) {
      const location = (ctx.location as string | undefined)?.toLowerCase() ?? "";
      if (location && !location.includes(rule.eligibility.location.toLowerCase())) {
        violations.push({
          code: "ELIGIBILITY_LOCATION_MISMATCH",
          message: `This chama requires members from ${rule.eligibility.location}`,
        });
      }
    }
    if (rule.eligibility.employer) {
      const employer = (ctx.employer as string | undefined)?.toLowerCase() ?? "";
      if (employer && !employer.includes(rule.eligibility.employer.toLowerCase())) {
        violations.push({
          code: "ELIGIBILITY_EMPLOYER_MISMATCH",
          message: `This chama requires members from ${rule.eligibility.employer}`,
        });
      }
    }
  }

  // Sponsorship: when required, ctx.sponsorIds.length must meet sponsorCount.
  if (rule.vetting?.sponsorRequired) {
    const sponsorIds = Array.isArray(ctx.sponsorIds) ? (ctx.sponsorIds as string[]) : [];
    if (sponsorIds.length < rule.vetting.sponsorCount) {
      violations.push({
        code: "VETTING_SPONSORS_INSUFFICIENT",
        message: `This chama requires ${rule.vetting.sponsorCount} sponsor(s); ${sponsorIds.length} provided`,
        hint: "Ask existing members to sponsor your application",
      });
    }
  }

  // Entry deposit: if a non-zero deposit is required, ctx.entryDepositPaid
  // must be true OR the application is queued as pending (caller's job).
  if (rule.entryDeposit && rule.entryDeposit.amountKes > 0) {
    const paid = ctx.entryDepositPaid === true;
    const queued = ctx.entryDepositQueued === true;
    if (!paid && !queued) {
      violations.push({
        code: "ENTRY_DEPOSIT_REQUIRED",
        message: `An entry deposit of KES ${rule.entryDeposit.amountKes.toLocaleString()} is required`,
        hint: rule.entryDeposit.refundableOnExit
          ? "This deposit is refundable on exit"
          : "This deposit is non-refundable",
      });
    }
  }

  return { allowed: violations.length === 0, violations };
}

function evalContributionReceived(rule: RuleDoc, ctx: HookContext): EvaluationResult {
  const violations: RuleViolation[] = [];
  const c = rule.contribution;

  const amount = typeof ctx.amount === "number" ? (ctx.amount as number) : NaN;
  if (!Number.isNaN(amount) && amount < c.amountKes) {
    violations.push({
      code: "CONTRIBUTION_BELOW_MIN",
      message: `Contribution amount KES ${amount.toLocaleString()} is below the required KES ${c.amountKes.toLocaleString()}`,
      hint: `Top up by KES ${(c.amountKes - amount).toLocaleString()}`,
    });
  }

  // Late-payment flag (warning, not a hard block — recorded as violation
  // only when enforcement wants to surface it; callers can downgrade).
  const now = ctx.receivedAt instanceof Date ? (ctx.receivedAt as Date) : new Date();
  const isLate = computeIsLate(c, now);
  if (isLate) {
    violations.push({
      code: "CONTRIBUTION_LATE",
      message: `Contribution received past day ${c.dueDay} + ${c.graceDays} grace days`,
      hint: "Late contributions may count against your standing",
    });
  }

  return { allowed: violations.length === 0, violations };
}

function computeIsLate(c: ContributionRule, when: Date): boolean {
  // For monthly cadence: late if current day-of-month > dueDay + graceDays.
  // For other cadences we conservatively return false here — a future
  // schedule-walker can do per-cycle attribution.
  if (c.cadence !== "monthly") return false;
  const day = when.getUTCDate();
  return day > c.dueDay + c.graceDays;
}

function evalLoanRequest(_rule: RuleDoc, _ctx: HookContext): EvaluationResult {
  // Placeholder: default allow if no rules conflict. Future hooks: max
  // loan per member, group utilization cap, member tenure minimum. The
  // rule-doc schema does not currently encode a `loanRule` field — when
  // it does, parse it here.
  return { allowed: true, violations: [] };
}

function evalVoteCast(rule: RuleDoc, ctx: HookContext): EvaluationResult {
  const violations: RuleViolation[] = [];

  // Quorum check runs on `close` — per-cast we mostly trust DB constraints
  // (double-vote guard is in the votes service). When the caller signals
  // `phase: "close"`, evaluate quorum.
  if (ctx.phase === "close") {
    const totalEligible = Number(ctx.totalEligible ?? 0);
    const votesCast = Number(ctx.votesCast ?? 0);
    if (totalEligible > 0) {
      const pct = (votesCast / totalEligible) * 100;
      if (pct < rule.voting.quorumPct) {
        violations.push({
          code: "VOTING_QUORUM_NOT_MET",
          message: `Quorum of ${rule.voting.quorumPct}% not met (${pct.toFixed(1)}% participated)`,
          hint: "Re-open or extend the vote",
        });
      }
    }
  }

  return { allowed: violations.length === 0, violations };
}

function evalExitRequest(rule: RuleDoc, ctx: HookContext): EvaluationResult {
  // Compute the consequences of exit; we don't block — we annotate. The
  // exit service consumes `ctx.computedPenalty` (added below) to apply
  // forfeitures and refund delays.
  const violations: RuleViolation[] = [];
  if (!rule.exit) {
    return { allowed: true, violations: [] };
  }

  const computedPenalty: Record<string, unknown> = {
    forfeitEntryBond: rule.exit.penalty.forfeitEntryBond ?? false,
    forfeitPctOfShares: rule.exit.penalty.forfeitPctOfShares ?? 0,
    refundDelayDays: rule.exit.penalty.refundDelayDays ?? 0,
    proRated: rule.exit.proRated,
  };
  // Mutating the caller's ctx is intentional — the exit handler reads
  // back the computed penalty so it can render it to the member.
  (ctx as { computedPenalty?: Record<string, unknown> }).computedPenalty = computedPenalty;

  if (rule.exit.trigger.manual === false && ctx.triggeredManually === true) {
    violations.push({
      code: "EXIT_MANUAL_NOT_ALLOWED",
      message: "This chama does not allow manual exit requests",
    });
  }

  return { allowed: violations.length === 0, violations };
}

async function evalPayoutInitiate(
  rule: RuleDoc,
  chamaId: string,
  ctx: HookContext
): Promise<EvaluationResult> {
  const violations: RuleViolation[] = [];

  if (rule.payoutOrder) {
    switch (rule.payoutOrder.mode) {
      case "rotational": {
        const cycleIndex = typeof ctx.cycleIndex === "number" ? (ctx.cycleIndex as number) : -1;
        const recipientId = ctx.recipientId as string | undefined;
        const seed = rule.payoutOrder.rotationSeed ?? [];
        if (cycleIndex >= 0 && seed.length > 0 && recipientId) {
          const expected = seed[cycleIndex % seed.length];
          if (expected !== recipientId) {
            violations.push({
              code: "PAYOUT_ROTATION_OUT_OF_ORDER",
              message: `Payout cycle ${cycleIndex} is for member ${expected}, not ${recipientId}`,
            });
          }
        }
        break;
      }
      case "by_vote": {
        const passed = ctx.votePassed === true;
        if (!passed) {
          violations.push({
            code: "PAYOUT_VOTE_REQUIRED",
            message: "Payout requires a passed members' vote",
          });
        }
        break;
      }
      case "by_need":
      case "lump_sum_at_term":
        // No structural block here — the caller decides timing/eligibility.
        break;
    }
  }

  // Optional balance check: when the ledger service is available we
  // confirm chama_pool_wallet covers the amount. Today we stub by reading
  // Chama.totalFunds; swap for ledger.balanceForChama once it lands.
  const amount = typeof ctx.amount === "number" ? (ctx.amount as number) : 0;
  if (amount > 0) {
    try {
      const chama = await prisma.chama.findUnique({
        where: { id: chamaId },
        select: { totalFunds: true },
      });
      const balance = Number(chama?.totalFunds ?? 0);
      if (balance < amount) {
        violations.push({
          code: "PAYOUT_INSUFFICIENT_POOL",
          message: `Chama pool balance KES ${balance.toLocaleString()} cannot cover payout of KES ${amount.toLocaleString()}`,
        });
      }
    } catch (err) {
      // TODO: integrate with ledger.balanceForChama when the double-entry
      // ledger service ships (RESEARCH_DOSSIER §7.1).
      logger.warn({ err, chamaId }, "rule-engine: payout balance check failed (non-blocking)");
    }
  }

  return { allowed: violations.length === 0, violations };
}
