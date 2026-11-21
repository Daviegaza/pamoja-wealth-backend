import crypto from "crypto";
import { prisma } from "../config/database.js";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/api-error.js";
import { toAmount } from "../utils/format.js";
import { generateReference } from "../utils/reference.js";
import type { RequestContext } from "../utils/http.js";
import { recordAudit, type Tx } from "./audit.service.js";
import { providerClient, type BillingProvider } from "./payment-providers.js";

/**
 * SaaS subscription billing — Pamoja's only revenue. A chama pays a flat
 * subscription fee; Pamoja charges no fees on contributions or loans and
 * never touches member money.
 *
 * Activation rule: a subscription is activated ONLY after a server-to-server
 * verify call to the provider confirms status=success, currency=KES and an
 * amount >= the invoice total for OUR reference. Webhook bodies and client
 * redirects are treated as hints to go and verify, never as proof.
 */

type PlanCode = "free" | "starter" | "pro" | "enterprise";
type Cadence = "monthly" | "annual";

/** Fallback when the plans table has not been seeded. */
const FREE_MEMBER_CAP = 15;

type Db = Tx | typeof prisma;

export async function listPlans() {
  const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { monthlyPriceKes: "asc" } });
  return plans.map((p) => ({
    code: p.code,
    name: p.name,
    monthlyPriceKes: toAmount(p.monthlyPriceKes),
    annualPriceKes: toAmount(p.annualPriceKes),
    memberCap: p.memberCap,
  }));
}

function isSubscriptionLive(sub: { status: string; currentPeriodEnd: Date } | null, now = new Date()): boolean {
  return !!sub && (sub.status === "active" || sub.status === "trialing") && sub.currentPeriodEnd > now;
}

/** The plan whose limits apply right now (expired paid plans fall back to free). */
export async function effectivePlan(db: Db, chamaId: string): Promise<{ code: PlanCode; memberCap: number | null }> {
  const sub = await db.subscription.findUnique({ where: { chamaId }, include: { plan: true } });
  if (sub && isSubscriptionLive(sub)) {
    return { code: sub.plan.code as PlanCode, memberCap: sub.plan.memberCap };
  }
  const free = await db.plan.findUnique({ where: { code: "free" } });
  return { code: "free", memberCap: free ? free.memberCap : FREE_MEMBER_CAP };
}

export async function getSubscriptionView(chamaId: string) {
  const [sub, plan, memberCount] = await Promise.all([
    prisma.subscription.findUnique({ where: { chamaId }, include: { plan: true } }),
    effectivePlan(prisma, chamaId),
    prisma.membership.count({ where: { chamaId, status: "active" } }),
  ]);
  const live = isSubscriptionLive(sub);
  return {
    planCode: plan.code,
    status: sub ? (live ? sub.status : sub.plan.code === "free" ? "active" : "past_due") : "active",
    cadence: sub?.cadence ?? "monthly",
    currentPeriodEnd: sub && sub.plan.code !== "free" ? sub.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    memberCap: plan.memberCap,
    memberCount,
  };
}

function addPeriod(from: Date, cadence: Cadence): Date {
  const d = new Date(from);
  if (cadence === "annual") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

async function ensureSubscriptionRow(tx: Tx, chamaId: string) {
  const existing = await tx.subscription.findUnique({ where: { chamaId } });
  if (existing) return existing;
  const free = await tx.plan.findUnique({ where: { code: "free" } });
  if (!free) throw ApiError.internal("Billing plans are not configured (run the plan seeder)");
  const now = new Date();
  return tx.subscription.create({
    data: {
      chamaId,
      planId: free.id,
      status: "active",
      cadence: "monthly",
      currentPeriodStart: now,
      currentPeriodEnd: new Date("9999-12-31T00:00:00Z"),
      provider: "manual",
    },
  });
}

export async function createCheckout(
  ctx: RequestContext,
  chamaId: string,
  input: { planCode: Exclude<PlanCode, "free">; cadence: Cadence; provider: BillingProvider },
) {
  const [plan, user, chama] = await Promise.all([
    prisma.plan.findUnique({ where: { code: input.planCode } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true, fullName: true } }),
    prisma.chama.findUnique({ where: { id: chamaId }, select: { name: true } }),
  ]);
  if (!plan || !plan.isActive) throw ApiError.validation("Unknown plan");
  if (!user || !chama) throw ApiError.notFound("Chama");

  const price = toAmount(input.cadence === "annual" ? plan.annualPriceKes : plan.monthlyPriceKes);
  if (price <= 0) throw ApiError.validation("This plan cannot be purchased online");

  const reference = generateReference("PWSUB");
  const now = new Date();

  const invoice = await prisma.$transaction(async (tx) => {
    const sub = await ensureSubscriptionRow(tx, chamaId);
    const inv = await tx.invoice.create({
      data: {
        subscriptionId: sub.id,
        number: `INV-${now.getUTCFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
        amountKes: price,
        totalKes: price,
        status: "open",
        periodStart: now,
        periodEnd: addPeriod(now, input.cadence),
        dueAt: new Date(now.getTime() + 24 * 3600 * 1000),
        provider: input.provider,
        reference,
        planCode: input.planCode,
        cadence: input.cadence,
      },
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "subscription.checkout_started",
      entityType: "invoice",
      entityId: inv.id,
      details: { planCode: input.planCode, cadence: input.cadence, provider: input.provider, totalKes: price },
    });
    return inv;
  });

  const redirectUrl = `${config.appUrl}/billing/return?chamaId=${encodeURIComponent(chamaId)}&reference=${encodeURIComponent(reference)}`;
  const checkoutUrl = await providerClient.initCheckout({
    provider: input.provider,
    reference,
    amountKes: price,
    email: user.email,
    customerName: user.fullName,
    redirectUrl,
    description: `${plan.name} plan (${input.cadence}) for ${chama.name}`,
  });

  return { invoiceId: invoice.id, reference, checkoutUrl };
}

export type VerifyOutcome =
  | { activated: true; alreadyProcessed: boolean }
  | { activated: false; reason: "pending" | "failed" | "mismatch" };

/**
 * Verify `reference` with its provider and activate the subscription if (and
 * only if) the provider confirms a successful KES charge covering the invoice.
 *
 * `expectedChamaId` scopes the lookup for user-initiated verification so a
 * member of chama A cannot poke chama B's invoice (404 instead).
 */
export async function verifyAndActivate(
  reference: string,
  ctx: RequestContext | null,
  expectedChamaId?: string,
): Promise<VerifyOutcome> {
  const invoice = await prisma.invoice.findUnique({
    where: { reference },
    include: { subscription: { select: { chamaId: true } } },
  });
  if (!invoice || (expectedChamaId && invoice.subscription.chamaId !== expectedChamaId)) {
    throw ApiError.notFound("Invoice");
  }
  if (invoice.status === "paid") return { activated: true, alreadyProcessed: true };
  if (invoice.provider !== "flutterwave" && invoice.provider !== "paystack") {
    throw ApiError.validation("Invoice is not payable online");
  }
  if (!invoice.planCode || !invoice.cadence) throw ApiError.validation("Invoice has no plan attached");

  const result = await providerClient.verifyPayment(invoice.provider, reference);
  const chamaId = invoice.subscription.chamaId;
  const expected = toAmount(invoice.totalKes);

  if (!result.successful) {
    if (result.failed) {
      await prisma.invoice.updateMany({
        where: { id: invoice.id, status: { not: "paid" } },
        data: { status: "failed", attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      return { activated: false, reason: "failed" };
    }
    return { activated: false, reason: "pending" };
  }

  const amountOk = result.amountKes + 0.005 >= expected;
  const currencyOk = result.currency.toUpperCase() === "KES";
  const referenceOk = result.reference === reference;
  if (!amountOk || !currencyOk || !referenceOk) {
    logger.error(
      { reference, expected, got: result.amountKes, currency: result.currency, providerRef: result.reference },
      "subscription payment verification mismatch — NOT activating",
    );
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, ctx, {
        chamaId,
        action: "subscription.verification_mismatch",
        entityType: "invoice",
        entityId: invoice.id,
        details: { expectedKes: expected, providerAmount: result.amountKes, currency: result.currency, referenceOk },
      });
    });
    return { activated: false, reason: "mismatch" };
  }

  const planCode = invoice.planCode;
  const cadence = invoice.cadence as Cadence;
  const activated = await prisma.$transaction(async (tx) => {
    // Conditional update makes activation idempotent under concurrent
    // webhook + redirect verification: only one caller flips open -> paid.
    const flipped = await tx.invoice.updateMany({
      where: { id: invoice.id, status: { not: "paid" } },
      data: { status: "paid", paidAt: new Date(), providerRef: result.providerTransactionId },
    });
    if (flipped.count !== 1) return false;

    const plan = await tx.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw ApiError.internal("Plan missing");
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId }, include: { plan: true } });
    const now = new Date();
    // Renewing the same live plan extends from the current period end.
    const start =
      isSubscriptionLive(sub, now) && sub.plan.code === planCode && sub.currentPeriodEnd < new Date("9999-01-01")
        ? sub.currentPeriodEnd
        : now;
    const end = addPeriod(start, cadence);

    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        planId: plan.id,
        status: "active",
        cadence,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        provider: invoice.provider,
        providerRef: result.providerTransactionId,
      },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { periodStart: start, periodEnd: end } });
    await tx.chama.update({ where: { id: chamaId }, data: { currentPlanCode: planCode } });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "subscription.activated",
      entityType: "subscription",
      entityId: sub.id,
      details: { planCode, cadence, invoiceId: invoice.id, periodEnd: end.toISOString(), verifiedWith: invoice.provider },
    });
    return true;
  });

  return { activated: true, alreadyProcessed: !activated };
}

export async function cancel(ctx: RequestContext, chamaId: string) {
  const sub = await prisma.subscription.findUnique({ where: { chamaId }, include: { plan: true } });
  if (!sub || sub.plan.code === "free") throw ApiError.validation("This chama has no paid subscription");
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "subscription.cancelled",
      entityType: "subscription",
      entityId: sub.id,
      details: { effectiveAt: sub.currentPeriodEnd.toISOString() },
    });
  });
  return getSubscriptionView(chamaId);
}

export async function listInvoices(chamaId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { subscription: { chamaId } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return invoices.map((i) => ({
    id: i.id,
    number: i.number,
    totalKes: toAmount(i.totalKes),
    status: i.status,
    planCode: i.planCode,
    cadence: i.cadence,
    periodStart: i.periodStart.toISOString(),
    periodEnd: i.periodEnd.toISOString(),
    paidAt: i.paidAt?.toISOString() ?? null,
    provider: i.provider,
  }));
}

/** Extract the reference from a provider webhook body (untrusted). */
export function referenceFromWebhook(provider: BillingProvider, body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = (b.data ?? {}) as Record<string, unknown>;
  if (provider === "flutterwave") {
    const ref = data.tx_ref ?? data.txRef;
    return typeof ref === "string" && ref.startsWith("PWSUB") ? ref : null;
  }
  if (b.event !== "charge.success") return null;
  const ref = data.reference;
  return typeof ref === "string" && ref.startsWith("PWSUB") ? ref : null;
}
