import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import * as billing from "../controllers/billing.controller.js";

const router = Router();

// ── Public ──────────────────────────────────────────────────────────

router.get("/plans", billing.listPlans);

// ── Subscription (per chama) ────────────────────────────────────────
// All mutating endpoints require Idempotency-Key (Stripe-style — see
// middleware/idempotency.ts). createCheckout in particular MUST be idempotent
// because retrying a checkout would otherwise stack STK pushes.

router.get("/subscription/:chamaId", authenticate, billing.getSubscription);

router.post(
  "/subscription/:chamaId/checkout",
  authenticate,
  idempotency(),
  billing.createCheckout,
);
router.post(
  "/subscription/:chamaId/cancel",
  authenticate,
  idempotency(),
  billing.cancelSubscriptionCtrl,
);
router.post(
  "/subscription/:chamaId/resume",
  authenticate,
  idempotency(),
  billing.resumeSubscriptionCtrl,
);
router.post(
  "/subscription/:chamaId/change-plan",
  authenticate,
  idempotency(),
  billing.changePlanCtrl,
);
router.post(
  "/subscription/:chamaId/apply-coupon",
  authenticate,
  idempotency(),
  billing.applyCouponCtrl,
);

// ── Invoices ────────────────────────────────────────────────────────

router.get("/invoices/:chamaId", authenticate, billing.listInvoicesCtrl);
router.get("/invoices/:chamaId/:invoiceId.pdf", authenticate, billing.invoicePdf);

// ── Legacy routes (kept for the existing FE shim) ───────────────────

router.get("/plan", authenticate, billing.getPlan);
router.post("/upgrade", authenticate, billing.upgrade);
router.post("/cancel", authenticate, billing.cancel);
router.get("/invoices", authenticate, billing.getInvoicesLegacy);

export default router;
