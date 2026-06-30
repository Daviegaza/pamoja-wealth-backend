/**
 * Plan-gate middleware — feature flags driven by the chama's current plan.
 *
 * Backed by the denormalised `chamas.currentPlanCode` column so we avoid a
 * JOIN against `subscriptions` + `plans` on every gated request. The Plan
 * row's `features` JSON is the source of truth for which booleans toggle each
 * `FeatureKey`. Service layer keeps `currentPlanCode` in sync with
 * Subscription changes (see `billing.service.ts:recordInvoicePayment`).
 *
 * Resolution:
 *   1. Look up chamaId from req.params.chamaId | req.params.id | req.body.chamaId.
 *   2. Read chama.currentPlanCode.
 *   3. Look up Plan by code; check features[FeatureKey].
 *   4. If false → 402 Payment Required with upgrade URL.
 *
 * 402 Payment Required is the correct HTTP status for "this works but your
 * plan doesn't include it." Clients can branch on `error.code === "FEATURE_LOCKED"`.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { logger } from "../config/logger.js";

export type FeatureKey =
  | "ai_rule_compiler"
  | "whatsapp_bot"
  | "ai_loan_underwriter"
  | "advanced_analytics"
  | "custom_branding"
  | "dedicated_paybill"
  | "api_access"
  | "white_label"
  | "audit_export"
  | "multi_group_consolidation";

function resolveChamaId(req: Request): string | null {
  return (
    (req.params?.chamaId as string | undefined) ??
    (req.params?.id as string | undefined) ??
    (req.body?.chamaId as string | undefined) ??
    (req.query?.chamaId as string | undefined) ??
    null
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => prisma as any;

async function planFeatures(planCode: string): Promise<Record<string, boolean> | null> {
  const plan = (await db().plan.findUnique({
    where: { code: planCode },
    select: { features: true },
  })) as { features: Record<string, boolean> } | null;
  return plan?.features ?? null;
}

/**
 * Programmatic check — call from services (e.g. rule-engine compile guard
 * inside a worker, where there's no Express request).
 */
export async function hasFeature(chamaId: string, feature: FeatureKey): Promise<boolean> {
  const chama = (await db().chama.findUnique({
    where: { id: chamaId },
    select: { currentPlanCode: true },
  })) as { currentPlanCode: string } | null;
  if (!chama) return false;
  const features = await planFeatures(chama.currentPlanCode);
  return !!features?.[feature];
}

export function requireFeature(feature: FeatureKey): RequestHandler {
  return async function planGate(req: Request, _res: Response, next: NextFunction) {
    const chamaId = resolveChamaId(req);
    if (!chamaId) {
      return next(ApiError.validation("chamaId is required for plan-gated routes"));
    }
    try {
      const chama = (await db().chama.findUnique({
        where: { id: chamaId },
        select: { currentPlanCode: true },
      })) as { currentPlanCode: string } | null;
      if (!chama) return next(ApiError.notFound("Chama", chamaId));

      const features = await planFeatures(chama.currentPlanCode);
      if (!features?.[feature]) {
        return next(
          new ApiError(
            "FEATURE_LOCKED",
            `This feature requires a higher plan (${feature}). Currently on ${chama.currentPlanCode}.`,
            402,
            { feature, currentPlan: chama.currentPlanCode, upgradeUrl: "/billing/upgrade" },
          ),
        );
      }
      return next();
    } catch (err) {
      logger.error({ err, feature, chamaId }, "plan-gate lookup failed");
      return next(err);
    }
  };
}
