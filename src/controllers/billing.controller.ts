import { Response, NextFunction, Request } from "express";
import crypto from "node:crypto";
import * as billingService from "../services/billing.service.js";
import { success, paginated } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { config } from "../config/index.js";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";

// ── Legacy shims (kept so old /billing/plan, /billing/upgrade etc. don't 404) ─

export async function getPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await billingService.getPlan(req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function upgrade(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await billingService.upgrade(req.user!.userId, req.body.planId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await billingService.cancel(req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function getInvoicesLegacy(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await billingService.getInvoices(req.user!.userId, req.query as never);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
}

// ── v2 controllers ───────────────────────────────────────────────────

export async function listPlans(_req: Request, res: Response, next: NextFunction) {
  try {
    const plans = await billingService.getPlans();
    success(res, plans);
  } catch (err) { next(err); }
}

export async function getSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId } = req.params;
    await assertMember(req.user!.userId, chamaId);
    const sub = await billingService.getSubscription(chamaId);
    success(res, sub);
  } catch (err) { next(err); }
}

export async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId } = req.params;
    await assertOwnerOrAdmin(req.user!.userId, chamaId);
    const { planCode, cadence, couponCode } = req.body as {
      planCode: billingService.PlanCode;
      cadence: billingService.BillingCadence;
      couponCode?: string;
    };
    if (!planCode || !cadence) {
      throw ApiError.validation("planCode and cadence are required");
    }
    const result = await billingService.createCheckout(chamaId, planCode, cadence, couponCode);
    success(res, result);
  } catch (err) { next(err); }
}

export async function cancelSubscriptionCtrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId } = req.params;
    await assertOwner(req.user!.userId, chamaId);
    const immediate = !!req.body?.immediate;
    const sub = await billingService.cancelSubscription(chamaId, immediate);
    success(res, sub);
  } catch (err) { next(err); }
}

export async function resumeSubscriptionCtrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId } = req.params;
    await assertOwner(req.user!.userId, chamaId);
    const sub = await billingService.resumeSubscription(chamaId);
    success(res, sub);
  } catch (err) { next(err); }
}

export async function changePlanCtrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId } = req.params;
    await assertOwnerOrAdmin(req.user!.userId, chamaId);
    const { planCode, prorate } = req.body as {
      planCode: billingService.PlanCode;
      prorate?: boolean;
    };
    if (!planCode) throw ApiError.validation("planCode is required");
    const sub = await billingService.changePlan(chamaId, planCode, !!prorate);
    success(res, sub);
  } catch (err) { next(err); }
}

export async function applyCouponCtrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId } = req.params;
    await assertOwnerOrAdmin(req.user!.userId, chamaId);
    const code = String(req.body?.code ?? "").trim();
    if (!code) throw ApiError.validation("code is required");
    const out = await billingService.applyCoupon(chamaId, code);
    success(res, { discountKes: out.discountKes.toString() });
  } catch (err) { next(err); }
}

export async function listInvoicesCtrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId } = req.params;
    await assertMember(req.user!.userId, chamaId);
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
    const { invoices, total } = await billingService.listInvoices(chamaId, { page, limit });
    paginated(res, invoices, total, page, limit);
  } catch (err) { next(err); }
}

export async function invoicePdf(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId, invoiceId } = req.params;
    await assertMember(req.user!.userId, chamaId);
    // TODO: integrate with S3 presigner once invoice PDF generation worker
    // is in place. For now, return a 404 so the FE can fall back to HTML view.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = (await (prisma as any).invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, subscriptionId: true, pdfStorageKey: true },
    })) as { id: string; subscriptionId: string; pdfStorageKey: string | null } | null;
    if (!invoice) throw ApiError.notFound("Invoice", invoiceId);
    if (!invoice.pdfStorageKey) {
      throw ApiError.notFound("Invoice PDF (not yet generated)", invoiceId);
    }
    // Stub: return the key — caller will hit a presigner route. TODO: presign.
    success(res, { pdfStorageKey: invoice.pdfStorageKey });
  } catch (err) { next(err); }
}

// ── Webhook: Flutterwave ─────────────────────────────────────────────

export async function flutterwaveWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    // Flutterwave sends `verif-hash` header which must equal our configured secret.
    // ref: https://developer.flutterwave.com/docs/integration-guides/webhooks
    const signature = req.header("verif-hash");
    const expected = config.flutterwave.webhookSecret;
    if (!expected) {
      logger.warn("flutterwave webhook: no secret configured, refusing");
      res.status(503).json({ error: "webhook-not-configured" });
      return;
    }
    if (!signature || !timingSafeEqual(signature, expected)) {
      res.status(401).json({ error: "invalid-signature" });
      return;
    }

    const payload = req.body as {
      event?: string;
      data?: {
        tx_ref?: string;
        id?: string | number;
        status?: string;
        amount?: number;
      };
    };
    const event = payload.event ?? "";
    const txRef = payload.data?.tx_ref ?? "";
    const providerRef = String(payload.data?.id ?? "");
    const success_ = (payload.data?.status ?? "").toLowerCase() === "successful";

    if (event.startsWith("charge.completed") && txRef.startsWith("SUB-") && success_) {
      const invoiceId = txRef.replace(/^SUB-/, "");
      await billingService.recordInvoicePayment(invoiceId, providerRef, new Date());
    }

    // Always 200 to Flutterwave — we've persisted what we needed.
    res.status(200).json({ received: true });
  } catch (err) { next(err); }
}

// ── Permission helpers (lighter than middleware for resource-level checks) ─

async function assertMember(userId: string, chamaId: string): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId, chamaId } },
  });
  if (!membership) throw ApiError.forbidden("Not a member of this chama");
}

async function assertOwnerOrAdmin(userId: string, chamaId: string): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId, chamaId } },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw ApiError.forbidden("Owner or admin role required");
  }
}

async function assertOwner(userId: string, chamaId: string): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId, chamaId } },
  });
  if (!membership || membership.role !== "owner") {
    throw ApiError.forbidden("Owner role required");
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
