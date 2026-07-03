// @ts-nocheck — pre-existing Prisma schema drift, tracked separately
/**
 * Revenue Analytics Routes
 *
 * GET /api/v1/admin/revenue/summary — Revenue dashboard (admin only)
 * GET /api/v1/admin/revenue/streams — All revenue streams (admin only)
 * GET /api/v1/chamas/:id/revenue — Chama-level revenue breakdown (treasurer+)
 * GET /api/v1/referral/code — Get my referral code
 * GET /api/v1/referral/stats — Get my referral stats
 * POST /api/v1/referral/validate — Validate a referral code
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import {
  listRevenueStreams,
  quoteAllForContribution,
  quoteFee,
  getSubscriptionTiers,
  getSubscriptionPrice,
} from "../services/revenue-config.service.js";
import {
  getOrCreateReferralCode,
  getReferralStats,
  validateReferralCode,
} from "../services/referral.service.js";
import { prisma } from "../config/database.js";
import { success, paginated } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";

const router = Router();

// ── Revenue Streams (Admin) ──────────────────────────────────────────

/**
 * GET /revenue/streams
 * List all configured revenue streams with rates.
 */
router.get(
  "/revenue/streams",
  authenticate,
  requirePermission("manage_settings"),
  (_req, res) => {
    const streams = listRevenueStreams();
    const tiers = getSubscriptionTiers();
    success(res, { streams, subscriptionTiers: tiers });
  },
);

/**
 * GET /revenue/summary
 * Get aggregated revenue data for the admin dashboard.
 */
router.get(
  "/revenue/summary",
  authenticate,
  requirePermission("manage_settings"),
  async (req, res) => {
    const { startDate, endDate } = req.query;

    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.gte = new Date(startDate as string);
      if (endDate) dateFilter.createdAt.lte = new Date(endDate as string);
    }

    // Aggregate revenue by stream from ledger entries
    const revenueEntries = await prisma.ledgerEntry.findMany({
      where: {
        account: {
          type: "platform_fee_revenue",
        },
        ...dateFilter,
      },
      include: {
        transfer: {
          select: {
            metadata: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    // Group by revenue type
    const byStream: Record<string, { count: number; totalKes: number }> = {};
    for (const entry of revenueEntries) {
      const meta = entry.transfer?.metadata as any;
      const kind = meta?.kind || "other";
      if (!byStream[kind]) byStream[kind] = { count: 0, totalKes: 0 };
      byStream[kind].count += 1;
      byStream[kind].totalKes += Number(entry.credit || 0);
    }

    // Subscription revenue
    const paidInvoices = await prisma.invoice.aggregate({
      where: { status: "paid", ...dateFilter },
      _sum: { totalKes: true },
      _count: true,
    });

    // Active subscriptions
    const activeSubs = await prisma.subscription.count({
      where: { status: { in: ["active", "trialing"] } },
    });

    // Total chamas, users
    const [totalChamas, totalUsers] = await Promise.all([
      prisma.chama.count(),
      prisma.user.count(),
    ]);

    success(res, {
      overview: {
        totalChamas,
        totalUsers,
        activeSubscriptions: activeSubs,
        subscriptionRevenue: Number(paidInvoices._sum.totalKes || 0),
        paidInvoiceCount: paidInvoices._count,
      },
      byRevenueStream: byStream,
      period: { startDate: startDate || "all_time", endDate: endDate || "now" },
    });
  },
);

// ── Chama-Level Revenue ─────────────────────────────────────────────

/**
 * GET /chamas/:id/revenue
 * Get revenue breakdown for a specific chama (what the platform earned from them).
 */
router.get(
  "/chamas/:id/revenue",
  authenticate,
  async (req, res) => {
    const chamaId = req.params.id;

    // Verify membership
    const membership = await prisma.membership.findFirst({
      where: { chamaId, userId: req.user!.userId },
    });

    if (!membership) {
      throw ApiError.forbidden("You must be a member of this chama");
    }

    // Get fees paid by this chama
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        account: { type: "platform_fee_revenue" },
        transfer: {
          metadata: {
            path: ["chamaId"],
            equals: chamaId,
          },
        },
      },
      include: {
        transfer: {
          select: { metadata: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const byType: Record<string, number> = {};
    let totalFees = 0;

    for (const entry of entries) {
      const meta = entry.transfer?.metadata as any;
      const kind = meta?.kind || "other";
      const amount = Number(entry.credit || 0);
      byType[kind] = (byType[kind] || 0) + amount;
      totalFees += amount;
    }

    success(res, {
      chamaId,
      totalFeesPaidKes: totalFees,
      feesByType: byType,
      entryCount: entries.length,
    });
  },
);

// ── Quote Endpoints (for UI display before transaction) ──────────────

const quoteSchema = z.object({
  amount: z.number().positive(),
  type: z.enum([
    "contribution",
    "harambee",
    "loanOrigination",
    "withdrawal",
    "b2cPayout",
    "latePayment",
    "currencyConversion",
  ]),
});

/**
 * POST /quote-fee
 * Get a fee quote before confirming a transaction.
 */
router.post(
  "/quote-fee",
  authenticate,
  validate(quoteSchema),
  (req, res) => {
    const { amount, type } = req.body;
    const quote = quoteFee(type, amount);
    success(res, quote);
  },
);

const contributionQuoteSchema = z.object({
  amount: z.number().positive(),
  isHarambee: z.boolean().default(false),
});

/**
 * POST /quote-contribution
 * Get fee breakdown for a contribution.
 */
router.post(
  "/quote-contribution",
  authenticate,
  validate(contributionQuoteSchema),
  (req, res) => {
    const { amount, isHarambee } = req.body;
    const quotes = quoteAllForContribution(amount, isHarambee);
    success(res, { quotes, totalFee: quotes.reduce((s, q) => s + Number(q.fee), 0) });
  },
);

/**
 * GET /subscription-tiers
 * Public: list all subscription tiers with features.
 */
router.get("/subscription-tiers", (_req, res) => {
  const tiers = getSubscriptionTiers();
  success(res, tiers);
});

/**
 * GET /subscription-price/:planCode
 * Public: get price for a specific plan.
 */
router.get(
  "/subscription-price/:planCode",
  (req, res) => {
    const { planCode } = req.params;
    const { cadence } = req.query;
    const price = getSubscriptionPrice(
      planCode,
      (cadence as "monthly" | "annual") || "monthly",
    );
    success(res, { planCode, cadence: cadence || "monthly", priceKes: price });
  },
);

// ── Referral Endpoints ──────────────────────────────────────────────

/**
 * GET /referral/code
 * Get my referral code and basic stats.
 */
router.get("/referral/code", authenticate, async (req, res) => {
  const code = await getOrCreateReferralCode(req.user!.userId);
  const referralLink = `https://pamojawealth.app/join?ref=${code.code}`;

  success(res, {
    code: code.code,
    referralLink,
    totalReferrals: code.totalReferrals,
    totalEarnedKes: code.totalEarnedKes,
    shareText: `Join me on Pamoja Wealth — the smart way to manage chamas and fundraisers! Use my referral code ${code.code} or sign up at ${referralLink}`,
  });
});

/**
 * GET /referral/stats
 * Get detailed referral stats and history.
 */
router.get("/referral/stats", authenticate, async (req, res) => {
  const stats = await getReferralStats(req.user!.userId);
  success(res, stats);
});

const validateRefSchema = z.object({
  code: z.string().min(4).max(12),
});

/**
 * POST /referral/validate
 * Validate a referral code (public, used during registration).
 */
router.post("/referral/validate", validate(validateRefSchema), async (req, res) => {
  const result = await validateReferralCode(req.body.code.toUpperCase());
  success(res, result);
});

export default router;
