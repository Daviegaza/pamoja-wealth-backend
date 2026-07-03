/**
 * Referral Program Service
 *
 * Track and reward user referrals. When a user invites another person who
 * creates a chama and subscribes to a paid plan, the referrer earns KES 500
 * and the referee gets 10% off their first 3 months.
 *
 * Flow:
 *   1. Existing user generates a referral code/link
 *   2. New user signs up with referral code
 *   3. When new user's chama subscribes to paid plan → trigger reward
 *   4. Referrer gets KES 500 credited to their wallet
 *   5. Referee gets 10% discount coupon applied to first 3 invoices
 */

import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { generateInviteCode } from "../utils/reference.js";
import { REVENUE_CONFIG } from "./revenue-config.service.js";
import * as ledger from "./ledger.service.js";
import * as notifications from "./notifications.service.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ReferralCode {
  id: string;
  userId: string;
  code: string;
  totalReferrals: number;
  totalEarnedKes: number;
  isActive: boolean;
  createdAt: Date;
}

export interface ReferralStats {
  referralCode: string;
  totalReferrals: number;
  totalEarnedKes: number;
  pendingRewards: number;
  referralHistory: ReferralEvent[];
}

export interface ReferralEvent {
  id: string;
  referredUserEmail: string;
  chamaName: string;
  planCode: string;
  rewardKes: number;
  status: "pending" | "paid" | "cancelled";
  createdAt: Date;
}

// ── Referral Code Management ─────────────────────────────────────────

/**
 * Get or create a referral code for a user.
 */
export async function getOrCreateReferralCode(userId: string): Promise<ReferralCode> {
  let code = await prisma.referralCode.findUnique({ where: { userId } });

  if (!code) {
    // Generate unique code: 8 chars, alphanumeric
    let refCode = await generateUniqueRefCode();
    code = await prisma.referralCode.create({
      data: {
        userId,
        code: refCode,
        totalReferrals: 0,
        totalEarnedKes: 0,
        isActive: true,
      },
    });
    logger.info({ userId, refCode }, "Created new referral code");
  }

  return code as ReferralCode;
}

/**
 * Validate a referral code and return the referrer's info.
 */
export async function validateReferralCode(
  code: string,
): Promise<{ valid: boolean; referrerId?: string; referrerName?: string }> {
  const refCode = await prisma.referralCode.findFirst({
    where: { code: code.toUpperCase(), isActive: true },
    include: { user: { select: { id: true, fullName: true } } },
  });

  if (!refCode) return { valid: false };

  return {
    valid: true,
    referrerId: refCode.userId,
    referrerName: refCode.user.fullName,
  };
}

/**
 * Track a referral signup. Called during registration if referral code present.
 */
export async function trackReferralSignup(
  referredUserId: string,
  referralCode: string,
): Promise<void> {
  const { valid, referrerId } = await validateReferralCode(referralCode);
  if (!valid || !referrerId) return;

  // Don't allow self-referral
  if (referrerId === referredUserId) {
    logger.warn({ referredUserId }, "Self-referral attempted, ignoring");
    return;
  }

  await prisma.referralTracking.create({
    data: {
      referrerId,
      referredUserId,
      referralCode,
      status: "signed_up",
    },
  });

  logger.info({ referrerId, referredUserId, referralCode }, "Referral signup tracked");
}

/**
 * Process referral reward when a referred user's chama subscribes to paid plan.
 * Called by the billing service after successful subscription payment.
 */
export async function processReferralReward(
  chamaId: string,
  planCode: string,
): Promise<{ rewardPaid: boolean; amount: number }> {
  // Find if this chama's owner was referred
  const chama = await prisma.chama.findUnique({
    where: { id: chamaId },
    select: { ownerId: true, name: true },
  });

  if (!chama) return { rewardPaid: false, amount: 0 };

  const tracking = await prisma.referralTracking.findFirst({
    where: {
      referredUserId: chama.ownerId,
      status: "signed_up",
    },
  });

  if (!tracking) return { rewardPaid: false, amount: 0 };

  // Check if reward already paid for this chama
  const existingReward = await prisma.referralReward.findFirst({
    where: { trackingId: tracking.id, chamaId },
  });

  if (existingReward) {
    return { rewardPaid: false, amount: 0 }; // Already processed
  }

  const rewardKes = REVENUE_CONFIG.fees.referral.rewardKes;

  // Create reward record
  await prisma.referralReward.create({
    data: {
      trackingId: tracking.id,
      chamaId,
      amountKes: rewardKes,
      status: "pending",
    },
  });

  // Credit referrer's wallet via ledger
  try {
    const referrerWallet = await ledger.getOrCreateMemberWallet(tracking.referrerId);
    const rewardAccount = await ledger.getOrCreateSystemAccount("platform_referral_rewards");

    await ledger.postTransfer({
      idempotencyKey: `referral-reward:${tracking.id}:${chamaId}`,
      metadata: {
        kind: "referral_reward",
        referrerId: tracking.referrerId,
        referredUserId: tracking.referredUserId,
        chamaId,
        chamaName: chama.name,
        planCode,
        amount: rewardKes,
      },
      postings: [
        { accountId: rewardAccount.id, debit: rewardKes },
        { accountId: referrerWallet.id, credit: rewardKes },
      ],
    });

    // Update referral code stats
    await prisma.referralCode.update({
      where: { userId: tracking.referrerId },
      data: {
        totalReferrals: { increment: 1 },
        totalEarnedKes: { increment: rewardKes },
      },
    });

    // Update tracking status
    await prisma.referralTracking.update({
      where: { id: tracking.id },
      data: { status: "rewarded" },
    });

    // Update reward status
    await prisma.referralReward.updateMany({
      where: { trackingId: tracking.id, chamaId },
      data: { status: "paid" },
    });

    // Notify referrer
    await notifications.createNotification({
      userId: tracking.referrerId,
      type: "referral_reward",
      title: "You earned KES 500!",
      message: `Your referral signed up and subscribed to ${planCode}. KES ${rewardKes} has been added to your wallet.`,
      actionUrl: "/wallet",
    });

    // Generate referee discount coupon
    const discountPct = REVENUE_CONFIG.fees.referral.refereeDiscountPct;
    const couponCode = `REF${tracking.referralCode}${Date.now().toString(36).toUpperCase()}`;

    await prisma.coupon.create({
      data: {
        code: couponCode,
        percentOff: discountPct,
        appliesToPlans: ["starter", "pro", "enterprise"],
        maxRedemptions: 3, // First 3 months
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 6 months
        createdBy: "system",
      },
    });

    logger.info(
      {
        referrerId: tracking.referrerId,
        chamaId,
        planCode,
        rewardKes,
        couponCode,
      },
      "Referral reward processed successfully",
    );

    return { rewardPaid: true, amount: rewardKes };
  } catch (error) {
    logger.error({ error, trackingId: tracking.id }, "Failed to process referral reward");
    return { rewardPaid: false, amount: 0 };
  }
}

/**
 * Get referral stats for a user's dashboard.
 */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const refCode = await getOrCreateReferralCode(userId);

  const rewards = await prisma.referralReward.findMany({
    where: { tracking: { referrerId: userId } },
    include: {
      tracking: {
        include: {
          referredUser: { select: { email: true } },
        },
      },
      chama: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const referralHistory: ReferralEvent[] = rewards.map((r) => ({
    id: r.id,
    referredUserEmail: r.tracking.referredUser.email,
    chamaName: r.chama.name,
    planCode: "premium", // Simplified; could enhance to store planCode
    rewardKes: r.amountKes,
    status: r.status as "pending" | "paid" | "cancelled",
    createdAt: r.createdAt,
  }));

  const pendingRewards = rewards
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + r.amountKes, 0);

  return {
    referralCode: refCode.code,
    totalReferrals: refCode.totalReferrals,
    totalEarnedKes: refCode.totalEarnedKes,
    pendingRewards,
    referralHistory,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

async function generateUniqueRefCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInviteCode();
    const existing = await prisma.referralCode.findUnique({ where: { code } });
    if (!existing) return code;
  }
  // Fallback: long random
  return generateInviteCode() + generateInviteCode().slice(0, 4);
}
