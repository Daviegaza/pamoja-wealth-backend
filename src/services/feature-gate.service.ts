/**
 * Feature-gate helpers.
 *
 * Given a chamaId, resolves the active subscription, maps plan code → feature
 * list, exposes `hasFeature`. `requireFeature` is Express middleware that
 * returns 402 with an upgrade CTA payload when the caller's chama can't use
 * the requested feature.
 *
 * Personal features (trust score, referral cashout) are gated by the user's
 * "personal" subscription — resolved as the highest plan across all chamas
 * the user is a member of (a member of a Pro chama gets Pro features
 * everywhere on the platform for their personal account).
 */
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database.js";
import { REVENUE_CONFIG } from "./revenue-config.service.js";

type PlanCode = keyof typeof REVENUE_CONFIG.planFeatures;
export type FeatureName =
  | "basic_dashboard"
  | "manual_contributions"
  | "basic_reports"
  | "mpesa_contributions"
  | "chama_chat"
  | "meeting_scheduler"
  | "stk_push_automated"
  | "loan_management"
  | "basic_analytics"
  | "voting"
  | "document_storage"
  | "email_support"
  | "ai_rule_compiler"
  | "advanced_analytics"
  | "investment_tracking"
  | "priority_support"
  | "whatsapp_bot"
  | "recurring_billing"
  | "ai_loan_underwriter"
  | "dedicated_paybill"
  | "api_access"
  | "custom_branding"
  | "white_label"
  | "audit_export"
  | "multi_group"
  | "dedicated_csm";

const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };

export async function planForChama(chamaId: string): Promise<PlanCode> {
  const sub = await prisma.subscription.findFirst({
    where: { chamaId, status: { in: ["active", "trialing"] } },
    select: { plan: { select: { code: true } } },
    orderBy: { createdAt: "desc" },
  });
  return ((sub?.plan?.code as PlanCode) ?? "free");
}

export async function personalPlanForUser(userId: string): Promise<PlanCode> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "active" },
    select: { chamaId: true },
  });
  if (memberships.length === 0) return "free";
  const codes = await Promise.all(memberships.map((m) => planForChama(m.chamaId)));
  return codes.reduce<PlanCode>((best, c) => ((PLAN_RANK[c] ?? 0) > (PLAN_RANK[best] ?? 0) ? c : best), "free");
}

export async function hasChamaFeature(chamaId: string, feature: FeatureName): Promise<boolean> {
  const plan = await planForChama(chamaId);
  const list = REVENUE_CONFIG.planFeatures[plan] ?? [];
  return (list as readonly string[]).includes(feature);
}

export async function hasUserFeature(userId: string, feature: FeatureName): Promise<boolean> {
  const plan = await personalPlanForUser(userId);
  const list = REVENUE_CONFIG.planFeatures[plan] ?? [];
  return (list as readonly string[]).includes(feature);
}

function requiredPlanFor(feature: FeatureName): PlanCode {
  const order: PlanCode[] = ["free", "starter", "pro", "enterprise"];
  for (const p of order) {
    const list = REVENUE_CONFIG.planFeatures[p] ?? [];
    if ((list as readonly string[]).includes(feature)) return p;
  }
  return "enterprise";
}

/**
 * Middleware: returns 402 with upgrade CTA when the (chamaId param) chama
 * lacks the feature. Fetches chamaId from `req.params.id` or `req.params.chamaId`.
 */
export function requireChamaFeature(feature: FeatureName) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const chamaId = req.params.id ?? req.params.chamaId ?? req.body?.chamaId;
    if (!chamaId) { res.status(400).json({ success: false, error: { code: "MISSING_CHAMA", message: "chama id required" } }); return; }
    const ok = await hasChamaFeature(chamaId, feature);
    if (ok) return next();
    const requiredPlan = requiredPlanFor(feature);
    res.status(402).json({
      success: false,
      error: {
        code: "UPGRADE_REQUIRED",
        message: `Feature "${feature}" requires the ${requiredPlan.toUpperCase()} plan.`,
        feature,
        requiredPlan,
        upgradeUrl: `/pricing?target=${requiredPlan}&chama=${chamaId}`,
      },
    });
  };
}

export function requireUserFeature(feature: FeatureName) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ success: false, error: { code: "UNAUTHORIZED" } }); return; }
    const ok = await hasUserFeature(userId, feature);
    if (ok) return next();
    const requiredPlan = requiredPlanFor(feature);
    res.status(402).json({
      success: false,
      error: {
        code: "UPGRADE_REQUIRED",
        message: `Feature "${feature}" requires the ${requiredPlan.toUpperCase()} plan.`,
        feature,
        requiredPlan,
        upgradeUrl: `/pricing?target=${requiredPlan}`,
      },
    });
  };
}
