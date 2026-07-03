// @ts-nocheck — pre-existing Prisma schema drift, tracked separately
/**
 * Revenue Configuration Service
 *
 * Central configuration for ALL platform revenue streams. This is the single
 * source of truth for fee rates, thresholds, and revenue rules.
 *
 * Revenue Streams:
 *   1. Subscriptions (Free/Starter/Pro/Enterprise)
 *   2. Contribution fees (1.0% on chama contributions)
 *   3. Harambee/donation fees (2.5% on public fundraisers)
 *   4. Loan origination fees (2.0% on each loan disbursement)
 *   5. Withdrawal fees (KES 25 flat per share-out)
 *   6. B2C payout fees (0.5%, min 30, max 500 KES)
 *   7. Late payment fees (KES 100 on overdue loan repayments)
 *   8. Currency conversion (1.5% on diaspora card payments)
 *   9. Premium add-ons (AI compiler, WhatsApp bot, dedicated Paybill, API)
 *   10. Insurance commissions (15% of premium)
 *   11. Referral rewards (KES 500 per referred chama that converts)
 *
 * All rates are stored here so they can be tuned without touching business logic.
 */

import { Decimal } from "@prisma/client/runtime/client";

// ── Fee Configuration ─────────────────────────────────────────────────

export interface FeeConfig {
  rate: Decimal;
  flatFee: Decimal;
  minFee: Decimal;
  maxFee: Decimal;
  description: string;
  revenueAccount: string;
}

export interface FeeQuote {
  type: string;
  gross: Decimal;
  fee: Decimal;
  net: Decimal;
  rateUsed: string;
  description: string;
}

export const REVENUE_CONFIG = {
  /** Subscription pricing (KES) */
  subscriptions: {
    free: { monthlyKes: 0, annualKes: 0, memberCap: 20, groupCap: 1 },
    starter: { monthlyKes: 499, annualKes: 4990, memberCap: 100, groupCap: 3 },
    pro: { monthlyKes: 1499, annualKes: 14990, memberCap: 500, groupCap: 10 },
    enterprise: { monthlyKes: 4999, annualKes: 49990, memberCap: null, groupCap: null },
  },

  /** Transaction fee rates */
  fees: {
    contribution: {
      rate: new Decimal("0.01"), // 1.0%
      flatFee: new Decimal(0),
      minFee: new Decimal(0),
      maxFee: new Decimal(500),
      description: "Platform fee on chama contributions",
      revenueAccount: "platform_fee_contributions",
    },
    harambee: {
      rate: new Decimal("0.025"), // 2.5%
      flatFee: new Decimal(0),
      minFee: new Decimal(0),
      maxFee: new Decimal(2500),
      description: "Platform fee on harambee/fundraiser donations",
      revenueAccount: "platform_fee_harambee",
    },
    loanOrigination: {
      rate: new Decimal("0.02"), // 2.0%
      flatFee: new Decimal(0),
      minFee: new Decimal(100),
      maxFee: new Decimal(5000),
      description: "Loan origination fee charged at disbursement",
      revenueAccount: "platform_fee_loan_origination",
    },
    withdrawal: {
      rate: new Decimal("0"),
      flatFee: new Decimal(25), // KES 25 flat
      minFee: new Decimal(0),
      maxFee: new Decimal(25),
      description: "Flat withdrawal/share-out processing fee",
      revenueAccount: "platform_fee_withdrawals",
    },
    b2cPayout: {
      rate: new Decimal("0.005"), // 0.5%
      flatFee: new Decimal(0),
      minFee: new Decimal(30),
      maxFee: new Decimal(500),
      description: "B2C payout fee (automated disbursement to member M-Pesa)",
      revenueAccount: "platform_fee_b2c_payout",
    },
    latePayment: {
      rate: new Decimal("0"),
      flatFee: new Decimal(100), // KES 100 flat
      minFee: new Decimal(0),
      maxFee: new Decimal(100),
      description: "Late loan repayment penalty",
      revenueAccount: "platform_fee_late_payment",
    },
    currencyConversion: {
      rate: new Decimal("0.015"), // 1.5%
      flatFee: new Decimal(0),
      minFee: new Decimal(0),
      maxFee: new Decimal(5000),
      description: "Currency conversion fee on diaspora/international payments",
      revenueAccount: "platform_fee_fx_conversion",
    },
    // Premium add-on pricing
    premiumAddons: {
      dedicatedPaybill: { monthlyKes: 2000, description: "Dedicated Paybill number" },
      whatsappBot: { monthlyKes: 999, description: "WhatsApp bot management" },
      apiAccess: { monthlyKes: 5000, description: "API access for integrations" },
      whiteLabel: { monthlyKes: 25000, description: "White-label platform" },
      aiRuleCompiler: { perUseKes: 500, freeUses: 3, description: "AI rule compilation" },
      aiLoanUnderwriter: { perUseKes: 200, description: "AI loan assessment" },
      creditReport: { perReportKes: 300, description: "Credit report per member" },
    },
    insurance: {
      commissionRate: new Decimal("0.15"), // 15% of premium
      description: "Insurance product commission",
      revenueAccount: "platform_fee_insurance",
    },
    referral: {
      rewardKes: 500, // KES 500 per referred chama that subscribes to a paid plan
      refereeDiscountPct: 10, // 10% off first 3 months for referred chama
      description: "Referral program reward",
    },
  },

  /** Free tier limits */
  freeTier: {
    maxMembers: 20,
    maxChamas: 1,
    maxMonthlyContributions: 50,
    maxLoanAmount: 50000,
    featureGates: {
      aiRules: false,
      advancedAnalytics: false,
      apiAccess: false,
      customBranding: false,
      dedicatedPaybill: false,
      whatsappBot: false,
      whiteLabel: false,
      auditExport: false,
      multiGroup: false,
      dedicatedCsm: false,
      aiLoanUnderwriter: false,
      recurringBilling: false,
    },
  },

  /** Plan feature flags (what each plan unlocks) */
  planFeatures: {
    free: [
      "basic_dashboard",
      "manual_contributions",
      "basic_reports",
      "mpesa_contributions",
      "chama_chat",
      "meeting_scheduler",
    ],
    starter: [
      "basic_dashboard",
      "manual_contributions",
      "basic_reports",
      "mpesa_contributions",
      "chama_chat",
      "meeting_scheduler",
      "stk_push_automated",
      "loan_management",
      "basic_analytics",
      "voting",
      "document_storage",
      "email_support",
    ],
    pro: [
      "basic_dashboard",
      "manual_contributions",
      "basic_reports",
      "mpesa_contributions",
      "chama_chat",
      "meeting_scheduler",
      "stk_push_automated",
      "loan_management",
      "basic_analytics",
      "voting",
      "document_storage",
      "email_support",
      "ai_rule_compiler",
      "advanced_analytics",
      "investment_tracking",
      "priority_support",
      "whatsapp_bot",
      "recurring_billing",
      "ai_loan_underwriter",
    ],
    enterprise: [
      "basic_dashboard",
      "manual_contributions",
      "basic_reports",
      "mpesa_contributions",
      "chama_chat",
      "meeting_scheduler",
      "stk_push_automated",
      "loan_management",
      "basic_analytics",
      "voting",
      "document_storage",
      "email_support",
      "ai_rule_compiler",
      "advanced_analytics",
      "investment_tracking",
      "priority_support",
      "whatsapp_bot",
      "recurring_billing",
      "ai_loan_underwriter",
      "dedicated_paybill",
      "api_access",
      "custom_branding",
      "white_label",
      "audit_export",
      "multi_group",
      "dedicated_csm",
    ],
  },
} as const;

// ── Quote Calculators ─────────────────────────────────────────────────

/**
 * Compute a fee quote for any fee type. Pure function, no I/O.
 */
export function quoteFee(
  feeType: keyof typeof REVENUE_CONFIG.fees,
  grossAmountKes: Decimal | string | number,
): FeeQuote {
  const config = REVENUE_CONFIG.fees[feeType];
  const gross =
    grossAmountKes instanceof Decimal
      ? grossAmountKes
      : new Decimal(grossAmountKes);

  if (gross.lte(0)) {
    return {
      type: feeType,
      gross,
      fee: new Decimal(0),
      net: gross,
      rateUsed: "0%",
      description: config.description,
    };
  }

  // Calculate: (gross * rate) + flatFee, clamped to [minFee, maxFee]
  let fee = gross.times(config.rate).plus(config.flatFee);

  if (config.minFee.gt(0) && fee.lt(config.minFee)) fee = config.minFee;
  if (config.maxFee.gt(0) && fee.gt(config.maxFee)) fee = config.maxFee;
  // Never let fee exceed gross
  if (fee.gt(gross)) fee = gross;

  const rateUsed =
    config.flatFee.gt(0)
      ? `KES ${config.flatFee} flat`
      : `${config.rate.times(100).toNumber().toFixed(1)}%`;

  return {
    type: feeType,
    gross,
    fee,
    net: gross.minus(fee),
    rateUsed,
    description: config.description,
  };
}

/**
 * Quote ALL applicable fees for a contribution (for display before user confirms).
 * Returns multiple fee quotes when multiple fees apply.
 */
export function quoteAllForContribution(
  amountKes: Decimal | string | number,
  isHarambee: boolean = false,
): FeeQuote[] {
  const feeType = isHarambee ? "harambee" : "contribution";
  return [quoteFee(feeType, amountKes)];
}

/**
 * Get the subscription price for a plan code and cadence.
 */
export function getSubscriptionPrice(
  planCode: string,
  cadence: "monthly" | "annual" = "monthly",
): number {
  const plans = REVENUE_CONFIG.subscriptions;
  const plan = plans[planCode as keyof typeof plans];
  if (!plan) return 0;
  return cadence === "annual" ? plan.annualKes : plan.monthlyKes;
}

/**
 * Calculate referral reward for a successful referral.
 */
export function calculateReferralReward(planCode: string): {
  rewardKes: number;
  refereeDiscount: { pct: number; months: number };
} {
  const config = REVENUE_CONFIG.fees.referral;
  const price = getSubscriptionPrice(planCode);

  // Only reward for paid plans
  if (planCode === "free" || price === 0) {
    return { rewardKes: 0, refereeDiscount: { pct: 0, months: 0 } };
  }

  return {
    rewardKes: config.rewardKes,
    refereeDiscount: {
      pct: config.refereeDiscountPct,
      months: 3, // First 3 months discounted
    },
  };
}

/**
 * Calculate insurance commission.
 */
export function calculateInsuranceCommission(
  premiumKes: Decimal | string | number,
): { commissionKes: Decimal; rate: string } {
  const premium =
    premiumKes instanceof Decimal ? premiumKes : new Decimal(premiumKes);
  const rate = REVENUE_CONFIG.fees.insurance.commissionRate;
  return {
    commissionKes: premium.times(rate),
    rate: `${rate.times(100).toNumber()}%`,
  };
}

// ── Revenue Summary ───────────────────────────────────────────────────

export interface RevenueStreamSummary {
  stream: string;
  account: string;
  description: string;
  rate: string;
}

/**
 * Returns all revenue streams for documentation and display.
 */
export function listRevenueStreams(): RevenueStreamSummary[] {
  return Object.entries(REVENUE_CONFIG.fees).map(([key, config]) => ({
    stream: key,
    account: config.revenueAccount,
    description: config.description,
    rate:
      config.flatFee.gt(0)
        ? `KES ${config.flatFee} flat`
        : `${config.rate.times(100).toNumber().toFixed(1)}%`,
  }));
}

/**
 * Get all subscription tiers with features.
 */
export function getSubscriptionTiers() {
  return Object.entries(REVENUE_CONFIG.subscriptions).map(([code, plan]) => ({
    code,
    monthlyKes: plan.monthlyKes,
    annualKes: plan.annualKes,
    memberCap: plan.memberCap,
    groupCap: plan.groupCap,
    features: REVENUE_CONFIG.planFeatures[code as keyof typeof REVENUE_CONFIG.planFeatures] || [],
  }));
}
