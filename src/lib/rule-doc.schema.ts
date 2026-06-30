// Backend mirror of the frontend `ruleDocSchema` from
// /home/davie/WebstormProjects/pamoja-wealth/src/schemas/group.schema.ts
//
// Keep these schemas in sync — any change to the structured rule document
// shape must be reflected on both sides. The frontend is the source of truth
// for shape; this file exists so the backend can validate Claude-compiled
// rule docs without pulling in frontend code.

import { z } from "zod";

// Mirror frontend Role enum (see src/types/index.ts → Role). Manual review
// roles must be valid Pamoja roles.
const roleSchema = z.enum([
  "owner",
  "admin",
  "chairperson",
  "treasurer",
  "secretary",
  "member",
]);

export const contributionRuleSchema = z.object({
  amountKes: z.coerce.number().min(1, "Amount must be positive"),
  cadence: z.enum(["weekly", "biweekly", "monthly", "quarterly", "annual"]),
  dueDay: z.coerce.number().int().min(1).max(31),
  graceDays: z.coerce.number().int().min(0).max(60),
});

export const eligibilityRuleSchema = z.object({
  minAge: z.coerce.number().int().min(0).max(120).optional(),
  maxAge: z.coerce.number().int().min(0).max(120).optional(),
  genders: z.array(z.enum(["male", "female", "any"])).optional(),
  location: z.string().optional(),
  employer: z.string().optional(),
  custom: z.string().optional(),
});

export const vettingRuleSchema = z.object({
  sponsorRequired: z.boolean(),
  sponsorCount: z.coerce.number().int().min(0).max(20),
  voteThresholdPct: z.coerce.number().min(0).max(100),
  manualReviewByRoles: z.array(roleSchema),
});

export const votingRuleSchema = z.object({
  quorumPct: z.coerce.number().min(0).max(100),
  passThresholdPct: z.coerce.number().min(0).max(100),
  weightedByContribution: z.boolean(),
  weightedByTenureMonths: z.boolean(),
});

export const payoutOrderSchema = z.object({
  mode: z.enum(["rotational", "by_need", "by_vote", "lump_sum_at_term"]),
  rotationSeed: z.array(z.string()).optional(),
});

export const exitRuleSchema = z.object({
  trigger: z.object({
    missedContributions: z.coerce.number().int().min(0).optional(),
    window: z.enum(["rolling-6m", "rolling-12m", "absolute"]).optional(),
    manual: z.boolean().optional(),
  }),
  penalty: z.object({
    forfeitEntryBond: z.boolean().optional(),
    forfeitPctOfShares: z.coerce.number().min(0).max(100).optional(),
    refundDelayDays: z.coerce.number().int().min(0).optional(),
  }),
  proRated: z.boolean(),
});

export const dividendRuleSchema = z.object({
  policy: z.enum(["equal", "by_shares", "by_contribution", "by_tenure", "reinvest"]),
  payoutCadence: z.enum(["monthly", "quarterly", "annual", "at_term"]),
});

export const entryDepositRuleSchema = z.object({
  amountKes: z.coerce.number().min(0),
  refundableOnExit: z.boolean(),
  payableIn: z.coerce.number().int().min(1).max(24),
});

export const ruleDocSchema = z.object({
  version: z.coerce.number().int().min(1),
  entryDeposit: entryDepositRuleSchema.optional(),
  contribution: contributionRuleSchema,
  eligibility: eligibilityRuleSchema.optional(),
  vetting: vettingRuleSchema.optional(),
  voting: votingRuleSchema,
  payoutOrder: payoutOrderSchema.optional(),
  exit: exitRuleSchema.optional(),
  dividend: dividendRuleSchema.optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export type RuleDocFromSchema = z.infer<typeof ruleDocSchema>;
