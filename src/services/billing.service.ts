/**
 * Subscription billing service.
 *
 * Charges chama treasury (not individual members). Four plans (free/starter/
 * pro/enterprise) — pricing + features live in the `plans` table; this service
 * is the orchestration layer:
 *
 *   - createCheckout / startTrial → first-payment flow
 *   - generateInvoice            → cron-driven recurring billing
 *   - recordInvoicePayment       → callback handler (Daraja STK / Flutterwave webhook)
 *   - changePlan / cancel / resume / applyCoupon → lifecycle ops
 *
 * Revenue is recognised via the existing double-entry ledger:
 *   DR mpesa_clearing / CR platform_fee_revenue   (when invoice paid)
 *
 * The platform NEVER charges harambee donors directly — that's recognised
 * separately via `ledger.recordHarambeeDonation` at 2.5%.
 *
 * Provider routing (default → fallback):
 *   - chamas with KE treasurer phone → M-Pesa STK (or Ratiba mandate if present)
 *   - chamas with diaspora treasurer → Flutterwave (card / cross-border)
 *
 * Trial: 14d on Starter/Pro for any chama upgrading from free. Enterprise
 * never trials (requires sales). After 3 failed auto-collects → downgrade to
 * free + email treasurer (see `expire-trials` + `collect-overdue` workers).
 *
 * NOTE: VAT/tax — Kenya does not charge VAT on financial services for chamas
 * (KRA Act 1st Sched §28). taxKes is 0 for KES invoices. Document this in
 * the invoice PDF footer.
 */

import crypto from "node:crypto";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/api-error.js";
import * as ledger from "./ledger.service.js";
import { stkPush } from "./mpesa.service.js";
import { fire as fireDaraja } from "../lib/daraja-breaker.js";
import { normaliseMsisdn } from "./contribute.service.js";

// ── Types ────────────────────────────────────────────────────────────

export type PlanCode = "free" | "starter" | "pro" | "enterprise";
export type BillingCadence = "monthly" | "annual";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "paused";
export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "void"
  | "uncollectible"
  | "failed";
export type PaymentProvider =
  | "mpesa_ratiba"
  | "mpesa_stk"
  | "flutterwave"
  | "stripe"
  | "manual";

export interface Plan {
  id: string;
  code: PlanCode;
  name: string;
  monthlyPriceKes: Decimal;
  annualPriceKes: Decimal;
  memberCap: number | null;
  groupCap: number | null;
  features: Record<string, boolean>;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  chamaId: string;
  planId: string;
  cadence: BillingCadence;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  provider: PaymentProvider;
  providerRef: string | null;
  collectionFailures: number;
  couponCode: string | null;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  number: string;
  amountKes: Decimal;
  discountKes: Decimal;
  taxKes: Decimal;
  totalKes: Decimal;
  status: InvoiceStatus;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  paidAt: Date | null;
  provider: PaymentProvider;
  providerRef: string | null;
  attempts: number;
}

export interface CheckoutResult {
  checkoutUrl?: string;
  stkInitiated?: boolean;
  trialEndsAt?: Date;
  invoiceId?: string;
  subscriptionId: string;
}

// ── Constants ────────────────────────────────────────────────────────

const TRIAL_DAYS = 14;
const DUE_GRACE_DAYS = 3; // M-Changa backlash teaches us: be patient before dunning
const MAX_DUNNING_ATTEMPTS = 3;
const SACCO_DISCOUNT_PCT = 50;
const ZERO = new Decimal(0);
const ONE_HUNDRED = new Decimal(100);

// ── Helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => prisma as any;

function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setMonth(out.getMonth() + n);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

function toDecimal(v: Decimal | string | number | undefined | null): Decimal {
  if (v === undefined || v === null) return ZERO;
  if (v instanceof Decimal) return v;
  return new Decimal(v);
}

async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db().invoice.count({
    where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
  });
  return `INV-${year}-${String(count + 1).padStart(6, "0")}`;
}

function periodLengthMonths(cadence: BillingCadence): number {
  return cadence === "annual" ? 12 : 1;
}

function basePriceFor(plan: Plan, cadence: BillingCadence): Decimal {
  return cadence === "annual" ? toDecimal(plan.annualPriceKes) : toDecimal(plan.monthlyPriceKes);
}

// ── Public API ───────────────────────────────────────────────────────

export async function getPlans(): Promise<Plan[]> {
  const plans = await db().plan.findMany({
    where: { isActive: true },
    orderBy: { monthlyPriceKes: "asc" },
  });
  return plans as Plan[];
}

export async function getPlanByCode(code: PlanCode): Promise<Plan | null> {
  return (await db().plan.findUnique({ where: { code } })) as Plan | null;
}

export async function getSubscription(chamaId: string): Promise<(Subscription & { plan: Plan }) | null> {
  return (await db().subscription.findUnique({
    where: { chamaId },
    include: { plan: true },
  })) as (Subscription & { plan: Plan }) | null;
}

// ── Eligibility (member cap, group cap) ──────────────────────────────

async function assertPlanEligible(chamaId: string, plan: Plan): Promise<void> {
  if (plan.memberCap !== null && plan.memberCap !== undefined) {
    const members = await prisma.membership.count({
      where: { chamaId, status: "active" },
    });
    if (members > plan.memberCap) {
      throw ApiError.validation(
        `Plan ${plan.code} caps members at ${plan.memberCap}; this chama has ${members} active members. Choose a higher tier.`,
        { memberCap: plan.memberCap, currentMembers: members },
      );
    }
  }
  // groupCap is enforced per-owner across all chamas they own. Cheap to check.
  if (plan.groupCap !== null && plan.groupCap !== undefined) {
    const chama = await prisma.chama.findUnique({
      where: { id: chamaId },
      select: { id: true },
    });
    if (!chama) throw ApiError.notFound("Chama", chamaId);
    const owner = await prisma.membership.findFirst({
      where: { chamaId, role: "owner" },
      select: { userId: true },
    });
    if (owner) {
      const ownedCount = await prisma.membership.count({
        where: { userId: owner.userId, role: "owner" },
      });
      if (ownedCount > plan.groupCap) {
        throw ApiError.validation(
          `Plan ${plan.code} caps groups at ${plan.groupCap}; owner runs ${ownedCount}. Choose enterprise.`,
        );
      }
    }
  }
}

// ── Coupon / discount calc ───────────────────────────────────────────

interface DiscountResult {
  discountKes: Decimal;
  saccoApplied: boolean;
  couponApplied: boolean;
}

async function computeDiscount(
  chamaId: string,
  plan: Plan,
  base: Decimal,
  couponCode: string | null | undefined,
): Promise<DiscountResult> {
  let discount = ZERO;
  let saccoApplied = false;
  let couponApplied = false;

  // SASRA-registered SACCOs get 50% off (manual review marks saccoRegNumber).
  const chama = (await db().chama.findUnique({
    where: { id: chamaId },
    select: { saccoRegNumber: true },
  })) as { saccoRegNumber: string | null } | null;
  if (chama?.saccoRegNumber) {
    discount = base.times(SACCO_DISCOUNT_PCT).div(ONE_HUNDRED);
    saccoApplied = true;
  }

  if (couponCode) {
    const coupon = (await db().coupon.findUnique({ where: { code: couponCode } })) as {
      code: string;
      percentOff: number | null;
      amountOffKes: Decimal | null;
      appliesToPlans: PlanCode[];
      maxRedemptions: number | null;
      timesRedeemed: number;
      validUntil: Date | null;
    } | null;
    if (!coupon) throw ApiError.validation(`Coupon ${couponCode} not found`);
    if (coupon.validUntil && coupon.validUntil < new Date()) {
      throw ApiError.validation(`Coupon ${couponCode} has expired`);
    }
    if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) {
      throw ApiError.validation(`Coupon ${couponCode} fully redeemed`);
    }
    if (coupon.appliesToPlans.length > 0 && !coupon.appliesToPlans.includes(plan.code)) {
      throw ApiError.validation(`Coupon ${couponCode} not valid for plan ${plan.code}`);
    }
    let couponDiscount = ZERO;
    if (coupon.percentOff) {
      couponDiscount = base.times(coupon.percentOff).div(ONE_HUNDRED);
    }
    if (coupon.amountOffKes) {
      couponDiscount = couponDiscount.plus(toDecimal(coupon.amountOffKes));
    }
    // SACCO + coupon stack (best-of-both for the chama). Cap at base price.
    discount = discount.plus(couponDiscount);
    couponApplied = true;
  }

  if (discount.gt(base)) discount = base;
  return { discountKes: discount, saccoApplied, couponApplied };
}

export async function applyCoupon(
  chamaId: string,
  code: string,
): Promise<{ discountKes: Decimal }> {
  const sub = await getSubscription(chamaId);
  if (!sub) throw ApiError.notFound("Subscription for chama", chamaId);
  const base = basePriceFor(sub.plan, sub.cadence);
  const { discountKes } = await computeDiscount(chamaId, sub.plan, base, code);
  await db().subscription.update({
    where: { id: sub.id },
    data: { couponCode: code },
  });
  return { discountKes };
}

// ── Trial / checkout / lifecycle ─────────────────────────────────────

export async function startTrial(chamaId: string, planCode: PlanCode): Promise<Subscription> {
  if (planCode === "free" || planCode === "enterprise") {
    throw ApiError.validation(`Trials only available for starter/pro plans, not ${planCode}`);
  }
  const plan = await getPlanByCode(planCode);
  if (!plan) throw ApiError.notFound("Plan", planCode);

  await assertPlanEligible(chamaId, plan);

  // Reject double-trial: a chama that already has a non-free subscription history
  // can't restart a trial. We check `cancelledAt IS NULL OR planCode != free`.
  const existing = await getSubscription(chamaId);
  if (existing && existing.plan.code !== "free") {
    throw ApiError.conflict(
      `Chama already on plan ${existing.plan.code}; trials are one-time for new paid subscribers.`,
    );
  }

  const now = new Date();
  const trialEnd = addDays(now, TRIAL_DAYS);

  const sub = await db().subscription.upsert({
    where: { chamaId },
    create: {
      chamaId,
      planId: plan.id,
      cadence: "monthly",
      status: "trialing",
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      trialEndsAt: trialEnd,
      provider: "mpesa_stk",
    },
    update: {
      planId: plan.id,
      status: "trialing",
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      trialEndsAt: trialEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
  });

  await prisma.chama.update({
    where: { id: chamaId },
    data: { currentPlanCode: planCode } as never,
  });

  logger.info({ chamaId, planCode, trialEnd }, "billing.startTrial");
  return sub as Subscription;
}

export async function createCheckout(
  chamaId: string,
  planCode: PlanCode,
  cadence: BillingCadence,
  couponCode?: string,
): Promise<CheckoutResult> {
  const plan = await getPlanByCode(planCode);
  if (!plan) throw ApiError.notFound("Plan", planCode);

  // Free plan = downgrade path: handled by changePlan, not checkout.
  if (plan.code === "free") {
    throw ApiError.validation(
      "Free plan does not require checkout — use change-plan to downgrade.",
    );
  }
  // Enterprise = sales-led; we return a sentinel URL the frontend can route to.
  if (plan.code === "enterprise") {
    const existing = await getSubscription(chamaId);
    return {
      subscriptionId: existing?.id ?? "",
      checkoutUrl: "/billing/contact-sales?plan=enterprise",
    };
  }

  await assertPlanEligible(chamaId, plan);

  const chama = await prisma.chama.findUnique({
    where: { id: chamaId },
    select: { id: true },
  });
  if (!chama) throw ApiError.notFound("Chama", chamaId);

  const existing = await getSubscription(chamaId);
  const isFirstPaid = !existing || existing.plan.code === "free";

  // Trial path — free → starter/pro for the first time.
  if (isFirstPaid && planCode !== "enterprise") {
    const sub = await startTrial(chamaId, planCode);
    return { subscriptionId: sub.id, trialEndsAt: sub.trialEndsAt ?? undefined };
  }

  // Otherwise generate an invoice immediately and try to collect.
  const now = new Date();
  const periodEnd = addMonths(now, periodLengthMonths(cadence));
  const base = basePriceFor(plan, cadence);
  const { discountKes } = await computeDiscount(chamaId, plan, base, couponCode);
  const totalKes = base.minus(discountKes);

  const sub = await db().subscription.upsert({
    where: { chamaId },
    create: {
      chamaId,
      planId: plan.id,
      cadence,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      provider: "mpesa_stk",
      couponCode: couponCode ?? null,
    },
    update: {
      planId: plan.id,
      cadence,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      couponCode: couponCode ?? null,
      collectionFailures: 0,
    },
  });

  const invoice = (await db().invoice.create({
    data: {
      subscriptionId: sub.id,
      number: await nextInvoiceNumber(),
      amountKes: base,
      discountKes,
      taxKes: ZERO, // Financial services exempt — KRA Act 1st Sched §28.
      totalKes,
      status: "open",
      periodStart: now,
      periodEnd,
      dueAt: addDays(now, DUE_GRACE_DAYS),
      provider: "mpesa_stk",
    },
  })) as Invoice;

  // Fire STK push to the treasurer's MSISDN. If we can't find one,
  // fall back to a Flutterwave hosted checkout link.
  const treasurerMsisdn = await resolveTreasurerMsisdn(chamaId);
  if (treasurerMsisdn) {
    await triggerStkForInvoice(invoice.id, treasurerMsisdn);
    return { subscriptionId: sub.id, invoiceId: invoice.id, stkInitiated: true };
  }
  const checkoutUrl = await createFlutterwaveCheckoutLink(invoice.id, totalKes);
  await db().invoice.update({
    where: { id: invoice.id },
    data: { provider: "flutterwave" },
  });
  await db().subscription.update({
    where: { id: sub.id },
    data: { provider: "flutterwave" },
  });
  return { subscriptionId: sub.id, invoiceId: invoice.id, checkoutUrl };
}

export async function cancelSubscription(
  chamaId: string,
  immediate?: boolean,
): Promise<Subscription> {
  const sub = await getSubscription(chamaId);
  if (!sub) throw ApiError.notFound("Subscription for chama", chamaId);
  if (sub.plan.code === "free") {
    throw ApiError.validation("Cannot cancel a free subscription. Delete the chama instead.");
  }
  const now = new Date();
  if (immediate) {
    await db().subscription.update({
      where: { id: sub.id },
      data: {
        status: "cancelled",
        cancelledAt: now,
        cancelAtPeriodEnd: true,
      },
    });
    await prisma.chama.update({
      where: { id: chamaId },
      data: { currentPlanCode: "free" } as never,
    });
  } else {
    await db().subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, cancelledAt: now },
    });
  }
  return (await getSubscription(chamaId)) as Subscription;
}

export async function resumeSubscription(chamaId: string): Promise<Subscription> {
  const sub = await getSubscription(chamaId);
  if (!sub) throw ApiError.notFound("Subscription for chama", chamaId);
  if (!sub.cancelAtPeriodEnd && sub.status === "active") {
    return sub;
  }
  if (sub.status === "cancelled") {
    throw ApiError.validation(
      "Subscription already cancelled — please go through checkout to restart.",
    );
  }
  await db().subscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: false, cancelledAt: null, status: "active" },
  });
  return (await getSubscription(chamaId)) as Subscription;
}

export async function changePlan(
  chamaId: string,
  newPlanCode: PlanCode,
  prorate: boolean,
): Promise<Subscription> {
  const sub = await getSubscription(chamaId);
  if (!sub) {
    // First-time signup uses createCheckout, not changePlan.
    throw ApiError.notFound("Subscription for chama", chamaId);
  }
  const newPlan = await getPlanByCode(newPlanCode);
  if (!newPlan) throw ApiError.notFound("Plan", newPlanCode);
  if (newPlan.code === sub.plan.code) {
    return sub;
  }
  await assertPlanEligible(chamaId, newPlan);

  const now = new Date();
  const oldBase = basePriceFor(sub.plan, sub.cadence);
  const newBase = basePriceFor(newPlan, sub.cadence);

  const upgrading = newBase.gt(oldBase);

  // Downgrades take effect end-of-period UNLESS the caller asks for immediate.
  // For an immediate downgrade we'd issue a credit memo; v1 = mark cancelAtPeriodEnd
  // and switch effective at currentPeriodEnd. (Free downgrade is immediate.)
  if (!upgrading && newPlan.code === "free") {
    await db().subscription.update({
      where: { id: sub.id },
      data: {
        planId: newPlan.id,
        cancelAtPeriodEnd: false,
        status: "active",
      },
    });
    await prisma.chama.update({
      where: { id: chamaId },
      data: { currentPlanCode: "free" } as never,
    });
    return (await getSubscription(chamaId)) as Subscription;
  }
  if (!upgrading && !prorate) {
    // Schedule the downgrade for the next period rollover. We DON'T mutate
    // planId yet — the rollover worker in `generate-due-invoices` swaps it in.
    await db().subscription.update({
      where: { id: sub.id },
      data: {
        // Stash the pending plan in `providerRef` is brittle; instead we use
        // couponCode as a tagged carrier `__downgrade_to:<code>`. TODO: dedicated
        // column when the next migration ships.
        couponCode: `__downgrade_to:${newPlan.code}`,
      },
    });
    return (await getSubscription(chamaId)) as Subscription;
  }

  // Upgrade (or immediate downgrade) → prorate.
  const periodMs = sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime();
  const remainingMs = Math.max(0, sub.currentPeriodEnd.getTime() - now.getTime());
  const fractionRemaining = periodMs > 0 ? remainingMs / periodMs : 0;
  const unusedCredit = oldBase.times(fractionRemaining.toFixed(6));
  const newProrated = newBase.times(fractionRemaining.toFixed(6));
  const proratedDelta = newProrated.minus(unusedCredit);

  if (prorate && proratedDelta.gt(0)) {
    const invoice = (await db().invoice.create({
      data: {
        subscriptionId: sub.id,
        number: await nextInvoiceNumber(),
        amountKes: newProrated,
        discountKes: unusedCredit,
        taxKes: ZERO,
        totalKes: proratedDelta,
        status: "open",
        periodStart: now,
        periodEnd: sub.currentPeriodEnd,
        dueAt: addDays(now, DUE_GRACE_DAYS),
        provider: sub.provider,
      },
    })) as Invoice;

    const treasurerMsisdn = await resolveTreasurerMsisdn(chamaId);
    if (treasurerMsisdn) {
      await triggerStkForInvoice(invoice.id, treasurerMsisdn);
    }
  }

  await db().subscription.update({
    where: { id: sub.id },
    data: { planId: newPlan.id, status: "active" },
  });
  await prisma.chama.update({
    where: { id: chamaId },
    data: { currentPlanCode: newPlan.code } as never,
  });

  logger.info({ chamaId, from: sub.plan.code, to: newPlan.code, prorate }, "billing.changePlan");
  return (await getSubscription(chamaId)) as Subscription;
}

// ── Invoice generation + payment ─────────────────────────────────────

export async function generateInvoice(subscriptionId: string): Promise<Invoice> {
  const sub = (await db().subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  })) as (Subscription & { plan: Plan }) | null;
  if (!sub) throw ApiError.notFound("Subscription", subscriptionId);

  // If a downgrade was scheduled, swap the plan in NOW (before pricing).
  let effectivePlan = sub.plan;
  if (sub.couponCode?.startsWith("__downgrade_to:")) {
    const targetCode = sub.couponCode.split(":")[1] as PlanCode;
    const target = await getPlanByCode(targetCode);
    if (target) {
      await db().subscription.update({
        where: { id: sub.id },
        data: { planId: target.id, couponCode: null },
      });
      await prisma.chama.update({
        where: { id: sub.chamaId },
        data: { currentPlanCode: target.code } as never,
      });
      effectivePlan = target;
      if (target.code === "free") {
        // Free plan doesn't generate invoices — short-circuit.
        return {
          id: "noop",
          subscriptionId,
          number: "NOOP",
          amountKes: ZERO,
          discountKes: ZERO,
          taxKes: ZERO,
          totalKes: ZERO,
          status: "void",
          periodStart: sub.currentPeriodEnd,
          periodEnd: addMonths(sub.currentPeriodEnd, 1),
          dueAt: sub.currentPeriodEnd,
          paidAt: null,
          provider: sub.provider,
          providerRef: null,
          attempts: 0,
        };
      }
    }
  }

  const periodStart = sub.currentPeriodEnd;
  const periodEnd = addMonths(periodStart, periodLengthMonths(sub.cadence));
  const base = basePriceFor(effectivePlan, sub.cadence);
  const { discountKes } = await computeDiscount(sub.chamaId, effectivePlan, base, sub.couponCode);
  const totalKes = base.minus(discountKes);

  const invoice = (await db().invoice.create({
    data: {
      subscriptionId: sub.id,
      number: await nextInvoiceNumber(),
      amountKes: base,
      discountKes,
      taxKes: ZERO,
      totalKes,
      status: "open",
      periodStart,
      periodEnd,
      dueAt: addDays(periodStart, DUE_GRACE_DAYS),
      provider: sub.provider,
    },
  })) as Invoice;

  // Advance the subscription period boundary.
  await db().subscription.update({
    where: { id: sub.id },
    data: {
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });

  logger.info(
    { invoiceId: invoice.id, subscriptionId, planCode: effectivePlan.code, totalKes: totalKes.toString() },
    "billing.generateInvoice",
  );
  return invoice;
}

export async function recordInvoicePayment(
  invoiceId: string,
  providerRef: string,
  paidAt: Date,
): Promise<Invoice> {
  const invoice = (await db().invoice.findUnique({
    where: { id: invoiceId },
  })) as Invoice | null;
  if (!invoice) throw ApiError.notFound("Invoice", invoiceId);
  if (invoice.status === "paid") {
    logger.info({ invoiceId }, "billing.recordInvoicePayment: already paid, no-op");
    return invoice;
  }

  const sub = (await db().subscription.findUnique({
    where: { id: invoice.subscriptionId },
    include: { plan: true },
  })) as (Subscription & { plan: Plan }) | null;
  if (!sub) throw ApiError.internal(`Invoice ${invoiceId} has no parent subscription`);

  // Ledger: DR mpesa_clearing / CR platform_fee_revenue.
  // For Flutterwave/Stripe, mpesa_clearing is a misnomer — we still funnel
  // through "external_clearing" semantically (use mpesa_clearing as the
  // catch-all asset until we add a generic `payment_clearing` type).
  const [clearing, feeRevenue] = await Promise.all([
    ledger.getOrCreateSystemAccount("mpesa_clearing"),
    ledger.getOrCreateSystemAccount("platform_fee_revenue"),
  ]);

  await ledger.postTransfer({
    idempotencyKey: `subscription-payment:${invoiceId}`,
    providerRef,
    metadata: {
      kind: "subscription_payment",
      invoiceId,
      subscriptionId: sub.id,
      chamaId: sub.chamaId,
      planCode: sub.plan.code,
      cadence: sub.cadence,
    },
    postings: [
      { accountId: clearing.id, debit: invoice.totalKes },
      { accountId: feeRevenue.id, credit: invoice.totalKes },
    ],
  });

  const updated = (await db().invoice.update({
    where: { id: invoiceId },
    data: { status: "paid", paidAt, providerRef },
  })) as Invoice;

  // Move subscription out of past_due / trialing into active and reset dunning.
  await db().subscription.update({
    where: { id: sub.id },
    data: {
      status: "active",
      collectionFailures: 0,
      trialEndsAt: null,
    },
  });

  await prisma.chama.update({
    where: { id: sub.chamaId },
    data: { currentPlanCode: sub.plan.code } as never,
  });

  logger.info(
    { invoiceId, subscriptionId: sub.id, chamaId: sub.chamaId, providerRef },
    "billing.recordInvoicePayment: paid + ledger posted",
  );
  return updated;
}

export async function markInvoiceFailed(invoiceId: string, reason: string): Promise<Invoice> {
  const invoice = (await db().invoice.findUnique({ where: { id: invoiceId } })) as Invoice | null;
  if (!invoice) throw ApiError.notFound("Invoice", invoiceId);
  const updated = (await db().invoice.update({
    where: { id: invoiceId },
    data: {
      status: invoice.attempts + 1 >= MAX_DUNNING_ATTEMPTS ? "uncollectible" : "failed",
      attempts: invoice.attempts + 1,
      lastAttemptAt: new Date(),
    },
  })) as Invoice;
  await db().subscription.update({
    where: { id: invoice.subscriptionId },
    data: {
      status: "past_due",
      collectionFailures: { increment: 1 },
    },
  });
  logger.warn({ invoiceId, reason, attempts: updated.attempts }, "billing.markInvoiceFailed");
  return updated;
}

export async function listInvoices(
  chamaId: string,
  query: { page: number; limit: number },
): Promise<{ invoices: Invoice[]; total: number }> {
  const sub = await getSubscription(chamaId);
  if (!sub) return { invoices: [], total: 0 };
  const [invoices, total] = await Promise.all([
    db().invoice.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db().invoice.count({ where: { subscriptionId: sub.id } }),
  ]);
  return { invoices: invoices as Invoice[], total };
}

// ── STK / Flutterwave trigger helpers ────────────────────────────────

async function resolveTreasurerMsisdn(chamaId: string): Promise<string | null> {
  // Treasurer first, fall back to owner. Look up their primary MpesaAccount,
  // fall back to user.phone.
  const candidate = await prisma.membership.findFirst({
    where: { chamaId, role: { in: ["treasurer", "owner"] }, status: "active" },
    orderBy: { role: "asc" }, // owner < treasurer alphabetically, but role::in keeps both
    select: { userId: true, role: true },
  });
  if (!candidate) return null;
  const mpesa = await prisma.mpesaAccount.findFirst({
    where: { userId: candidate.userId },
    orderBy: [{ isDefault: "desc" }, { isVerified: "desc" }, { lastUsed: "desc" }],
  });
  if (mpesa?.phoneNumber) {
    try {
      return normaliseMsisdn(mpesa.phoneNumber);
    } catch {
      return null;
    }
  }
  const user = await prisma.user.findUnique({
    where: { id: candidate.userId },
    select: { phone: true },
  });
  if (user?.phone) {
    try {
      return normaliseMsisdn(user.phone);
    } catch {
      return null;
    }
  }
  return null;
}

export async function triggerStkForInvoice(
  invoiceId: string,
  msisdn: string,
): Promise<{ checkoutRequestId: string }> {
  const invoice = (await db().invoice.findUnique({ where: { id: invoiceId } })) as Invoice | null;
  if (!invoice) throw ApiError.notFound("Invoice", invoiceId);
  const accountRef = `SUB-${invoice.id}`.slice(0, 12); // Daraja caps AccountReference at 12 chars
  const amount = Math.round(Number(invoice.totalKes));
  if (amount < 1) {
    // Zero-value invoice (full discount) — mark paid directly.
    await recordInvoicePayment(invoice.id, "ZERO_VALUE", new Date());
    return { checkoutRequestId: "zero-value" };
  }
  const stk = await fireDaraja(stkPush, msisdn, amount, accountRef);
  await db().invoice.update({
    where: { id: invoice.id },
    data: {
      provider: "mpesa_stk",
      providerRef: stk.checkoutRequestId,
      attempts: invoice.attempts + 1,
      lastAttemptAt: new Date(),
    },
  });
  return { checkoutRequestId: stk.checkoutRequestId };
}

/**
 * Generate a Flutterwave hosted-checkout URL for cross-border / card payers.
 * Stub — wire to real Flutterwave standard payments API once secret key is
 * provisioned. Returns a deterministic placeholder URL so the rest of the
 * flow is testable.
 *
 * TODO: Replace with axios POST to https://api.flutterwave.com/v3/payments
 *       with tx_ref=SUB-{invoiceId}, redirect_url, customer{email,phone}.
 */
export async function createFlutterwaveCheckoutLink(
  invoiceId: string,
  amount: Decimal,
): Promise<string> {
  logger.info(
    { invoiceId, amount: amount.toString() },
    "billing.createFlutterwaveCheckoutLink: STUB — returning placeholder",
  );
  const token = crypto.randomBytes(8).toString("hex");
  return `https://checkout.flutterwave.com/v3/hosted/pay/${token}?tx_ref=SUB-${invoiceId}`;
}

/**
 * M-Pesa Ratiba standing-order mandate URL generator. Daraja endpoint is
 *   POST /standingorder/v1/create
 * which is still partner-API-nascent (consumer rollout Sep 2024 — see
 * RESEARCH_DOSSIER §4). The returned URL is what the user opens in their
 * M-Pesa menu to authorise the mandate. We persist `providerRef` on the
 * Subscription once Safaricom returns the mandate ID via callback.
 *
 * TODO: Wire to real Daraja Ratiba endpoint when partner credentials land.
 */
export async function createRatibaMandate(
  subscriptionId: string,
  msisdn: string,
  amount: Decimal,
): Promise<{ mandateUrl: string }> {
  logger.info(
    { subscriptionId, msisdn, amount: amount.toString() },
    "billing.createRatibaMandate: STUB — returning placeholder mandate URL",
  );
  const token = crypto.randomBytes(8).toString("hex");
  return { mandateUrl: `mpesa://standingorder/authorise?token=${token}&sub=${subscriptionId}` };
}

// ── Worker entrypoints (called by BullMQ) ────────────────────────────

/**
 * Pick subscriptions whose `currentPeriodEnd <= now + 24h && status=active`,
 * generate invoices, trigger collection.
 */
export async function generateDueInvoices(): Promise<{ generated: number }> {
  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const subs = (await db().subscription.findMany({
    where: {
      status: { in: ["active", "trialing"] },
      currentPeriodEnd: { lte: horizon },
      cancelAtPeriodEnd: false,
    },
    select: { id: true },
    take: 200,
  })) as Array<{ id: string }>;

  let generated = 0;
  for (const s of subs) {
    try {
      const inv = await generateInvoice(s.id);
      if (inv.id !== "noop") {
        const sub = (await db().subscription.findUnique({
          where: { id: s.id },
          select: { chamaId: true, provider: true },
        })) as { chamaId: string; provider: PaymentProvider };
        const msisdn = await resolveTreasurerMsisdn(sub.chamaId);
        if (msisdn && (sub.provider === "mpesa_stk" || sub.provider === "mpesa_ratiba")) {
          try {
            await triggerStkForInvoice(inv.id, msisdn);
          } catch (err) {
            logger.warn({ err, invoiceId: inv.id }, "generateDueInvoices: STK trigger failed");
          }
        }
      }
      generated++;
    } catch (err) {
      logger.error({ err, subscriptionId: s.id }, "generateDueInvoices: failed");
    }
  }
  return { generated };
}

/**
 * Pick invoices `status=open && dueAt < now`, retry STK push, after 3 fails
 * mark `failed` (uncollectible) + downgrade subscription to free + notify.
 */
export async function collectOverdue(): Promise<{ retried: number; downgraded: number }> {
  const now = new Date();
  const candidates = (await db().invoice.findMany({
    where: {
      status: "open",
      dueAt: { lt: now },
    },
    take: 200,
  })) as Invoice[];

  let retried = 0;
  let downgraded = 0;

  for (const inv of candidates) {
    if (inv.attempts >= MAX_DUNNING_ATTEMPTS) {
      const sub = (await db().subscription.findUnique({
        where: { id: inv.subscriptionId },
        select: { chamaId: true, planId: true },
      })) as { chamaId: string; planId: string };
      const freePlan = await getPlanByCode("free");
      if (freePlan) {
        await db().subscription.update({
          where: { id: inv.subscriptionId },
          data: { planId: freePlan.id, status: "cancelled", cancelledAt: now },
        });
        await prisma.chama.update({
          where: { id: sub.chamaId },
          data: { currentPlanCode: "free" } as never,
        });
      }
      await db().invoice.update({
        where: { id: inv.id },
        data: { status: "uncollectible" },
      });
      // TODO: send email to treasurer ("Your Pamoja subscription has lapsed").
      logger.warn(
        { invoiceId: inv.id, chamaId: sub.chamaId },
        "collectOverdue: max attempts hit → downgraded to free",
      );
      downgraded++;
      continue;
    }

    const sub = (await db().subscription.findUnique({
      where: { id: inv.subscriptionId },
      select: { chamaId: true, provider: true },
    })) as { chamaId: string; provider: PaymentProvider };
    const msisdn = await resolveTreasurerMsisdn(sub.chamaId);
    if (!msisdn) {
      await markInvoiceFailed(inv.id, "no treasurer MSISDN");
      continue;
    }
    try {
      await triggerStkForInvoice(inv.id, msisdn);
      retried++;
    } catch (err) {
      await markInvoiceFailed(inv.id, (err as Error).message);
    }
  }
  return { retried, downgraded };
}

/**
 * Pick subscriptions where `status=trialing && trialEndsAt <= now`, auto-convert.
 * If STK fails → downgrade to free + email.
 */
export async function expireTrials(): Promise<{ converted: number; downgraded: number }> {
  const now = new Date();
  const trials = (await db().subscription.findMany({
    where: { status: "trialing", trialEndsAt: { lte: now } },
    include: { plan: true },
    take: 100,
  })) as Array<Subscription & { plan: Plan }>;

  let converted = 0;
  let downgraded = 0;

  for (const sub of trials) {
    const base = basePriceFor(sub.plan, sub.cadence);
    const { discountKes } = await computeDiscount(sub.chamaId, sub.plan, base, sub.couponCode);
    const totalKes = base.minus(discountKes);
    const periodStart = now;
    const periodEnd = addMonths(periodStart, periodLengthMonths(sub.cadence));

    const inv = (await db().invoice.create({
      data: {
        subscriptionId: sub.id,
        number: await nextInvoiceNumber(),
        amountKes: base,
        discountKes,
        taxKes: ZERO,
        totalKes,
        status: "open",
        periodStart,
        periodEnd,
        dueAt: addDays(periodStart, DUE_GRACE_DAYS),
        provider: sub.provider,
      },
    })) as Invoice;

    await db().subscription.update({
      where: { id: sub.id },
      data: {
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
      },
    });

    const msisdn = await resolveTreasurerMsisdn(sub.chamaId);
    if (!msisdn) {
      // No way to bill → downgrade.
      const freePlan = await getPlanByCode("free");
      if (freePlan) {
        await db().subscription.update({
          where: { id: sub.id },
          data: { planId: freePlan.id, status: "cancelled", cancelledAt: now },
        });
        await prisma.chama.update({
          where: { id: sub.chamaId },
          data: { currentPlanCode: "free" } as never,
        });
      }
      downgraded++;
      continue;
    }
    try {
      await triggerStkForInvoice(inv.id, msisdn);
      converted++;
    } catch (err) {
      logger.warn({ err, subscriptionId: sub.id }, "expireTrials: STK failed");
      await markInvoiceFailed(inv.id, (err as Error).message);
    }
  }
  return { converted, downgraded };
}

// ── Legacy compatibility shims (old controller still references these) ─

export async function getPlan(userId: string) {
  // Best-effort: return the plan of the first chama the user owns/admins.
  const membership = await prisma.membership.findFirst({
    where: { userId, role: { in: ["owner", "admin"] } },
    orderBy: { joinedAt: "asc" },
  });
  if (!membership) return { plan: "free", status: "active", nextBillingDate: null };
  const sub = await getSubscription(membership.chamaId);
  if (!sub) return { plan: "free", status: "active", nextBillingDate: null };
  return {
    plan: sub.plan.code,
    status: sub.status,
    nextBillingDate: sub.currentPeriodEnd.toISOString(),
  };
}

export async function upgrade(_userId: string, planId: string) {
  logger.info({ planId }, "billing.upgrade (legacy shim) — use POST /billing/subscription/:chamaId/checkout");
  return { plan: planId, status: "pending" };
}

export async function cancel(_userId: string) {
  logger.info("billing.cancel (legacy shim)");
  return { success: true };
}

export async function getInvoices(_userId: string, query: { page: number; pageSize: number }) {
  return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
}
