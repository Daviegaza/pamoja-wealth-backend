/**
 * Public routes — no authentication. Powers the shareable donate/invest links.
 *
 *   GET  /public/link/:token           - Preview a shareable link (safe metadata)
 *   POST /public/donate/:token         - Anonymous donation → M-Pesa STK Push
 *   POST /public/invest/:token         - Anonymous investment → STK + allocate shares
 *   GET  /public/link/:token/qr.png    - QR code PNG for the link
 *
 * Authenticated routes for chama owners lives in /shareable-links + /offerings.
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";
import * as sharelink from "../services/shareable-link.service.js";
import * as offering from "../services/share-offering.service.js";
import { stkPush } from "../services/mpesa.service.js";
import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

const router = Router();

// ── Public preview + QR ──────────────────────────────────────
router.get("/public/link/:token", async (req, res) => {
  const preview = await sharelink.publicPreview(req.params.token);
  if (!preview.ok) throw ApiError.notFound("Link");
  success(res, preview);
});

router.get("/public/link/:token/qr.png", async (req, res) => {
  const link = await sharelink.getLink(req.params.token);
  if (!link) throw ApiError.notFound("Link");
  const publicUrl = `${config.apiUrl.replace("api.", "").replace(":3000", ":5173")}/give/${link.token}`;
  const buf = await sharelink.qrBuffer(publicUrl);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(buf);
});

router.get("/public/link/:token/qr.svg", async (req, res) => {
  const link = await sharelink.getLink(req.params.token);
  if (!link) throw ApiError.notFound("Link");
  const publicUrl = `${config.apiUrl.replace("api.", "").replace(":3000", ":5173")}/give/${link.token}`;
  const dataUrl = await sharelink.qrDataUrl(publicUrl);
  success(res, { dataUrl, publicUrl });
});

// ── Public donation (anonymous) ──────────────────────────────
const donateSchema = z.object({
  amountKes: z.number().positive().max(1_000_000),
  phone: z.string().min(9).max(15),
  name: z.string().max(100).optional(),
  email: z.string().email().optional(),
  message: z.string().max(500).optional(),
  isAnonymous: z.boolean().optional(),
});

function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return "254" + digits.slice(1);
  if (digits.startsWith("7") || digits.startsWith("1")) return "254" + digits;
  return digits;
}

router.post("/public/donate/:token", validate(donateSchema), async (req, res) => {
  const link = await sharelink.getLink(req.params.token);
  if (!link || link.kind !== "donate") throw ApiError.notFound("Donation link");
  if (link.minAmountKes && req.body.amountKes < link.minAmountKes) {
    throw ApiError.validation(`Minimum donation is KES ${link.minAmountKes}`);
  }

  const phone = normalizePhone(req.body.phone);
  const reference = `DON${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 999)}`;

  // Persist donation as pending — updated to confirmed via M-Pesa callback.
  const donation = await prisma.donation.create({
    data: {
      chamaId: link.chamaId,
      donorName: req.body.isAnonymous ? null : req.body.name,
      donorEmail: req.body.isAnonymous ? null : req.body.email,
      donorPhone: phone,
      amount: req.body.amountKes,
      message: req.body.message,
      isAnonymous: !!req.body.isAnonymous,
      paymentMethod: "mpesa",
      reference,
    },
  });

  // Fire STK push. Any error, still return the pending donation so donor
  // can see "waiting for PIN" screen and complete on device.
  try {
    await stkPush(phone, req.body.amountKes, reference);
    // — donation/investment paths share the same 3-arg positional stkPush signature.
  } catch (err) {
    logger.warn({ err, reference }, "STK push failed for donation");
  }

  success(res, {
    ok: true,
    reference,
    donationId: donation.id,
    message: "Enter your M-Pesa PIN on your phone to complete the donation.",
  });
});

// ── Public investment (anonymous) ────────────────────────────
const investSchema = z.object({
  offeringId: z.string(),
  amountKes: z.number().positive().max(10_000_000),
  phone: z.string().min(9).max(15),
  name: z.string().max(100),
  email: z.string().email().optional(),
});

router.post("/public/invest/:token", validate(investSchema), async (req, res) => {
  const link = await sharelink.getLink(req.params.token);
  if (!link || link.kind !== "invest") throw ApiError.notFound("Investment link");

  const phone = normalizePhone(req.body.phone);
  const reference = `INV${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 999)}`;

  const holding = await offering.invest({
    offeringId: req.body.offeringId,
    amountKes: req.body.amountKes,
    investorName: req.body.name,
    investorPhone: phone,
    investorEmail: req.body.email,
    reference,
  });

  try {
    await stkPush(phone, req.body.amountKes, reference);
  } catch (err) {
    logger.warn({ err, reference }, "STK push failed for investment");
  }

  success(res, {
    ok: true,
    reference,
    holdingId: holding.id,
    sharesAllocated: holding.shares,
    message: "Enter your M-Pesa PIN to confirm the investment. Shares allocate on payment confirmation.",
  });
});

// ── Auth'd chama-owner routes: create/manage shareable links + offerings ──
const createLinkSchema = z.object({
  kind: z.enum(["donate", "invest", "join"]),
  chamaId: z.string().uuid(),
  title: z.string().optional(),
  description: z.string().optional(),
  minAmountKes: z.number().positive().optional(),
  maxAmountKes: z.number().positive().optional(),
  targetAmountKes: z.number().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

router.post("/shareable-links", authenticate, validate(createLinkSchema), async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { userId: req.user!.userId, chamaId: req.body.chamaId, role: { in: ["owner", "admin", "treasurer"] } },
  });
  if (!membership) throw ApiError.forbidden("Only owners / admins / treasurers can create links");

  const link = await sharelink.createLink({
    kind: req.body.kind,
    chamaId: req.body.chamaId,
    createdById: req.user!.userId,
    title: req.body.title,
    description: req.body.description,
    minAmountKes: req.body.minAmountKes,
    maxAmountKes: req.body.maxAmountKes,
    targetAmountKes: req.body.targetAmountKes,
    expiresAt: req.body.expiresAt,
  });
  const publicUrl = `${config.apiUrl.replace("api.", "").replace(":3000", ":5173")}/give/${link.token}`;
  const qrDataUrl = await sharelink.qrDataUrl(publicUrl);
  success(res, { link, publicUrl, qrDataUrl });
});

router.get("/shareable-links", authenticate, async (req, res) => {
  const chamaId = req.query.chamaId as string;
  if (!chamaId) throw ApiError.validation("chamaId required");
  const links = await sharelink.listLinks(chamaId);
  success(res, links);
});

router.delete("/shareable-links/:token", authenticate, async (req, res) => {
  await sharelink.disableLink(req.params.token);
  success(res, { ok: true });
});

// ── Offerings ────────────────────────────────────────────────
const createOfferingSchema = z.object({
  chamaId: z.string().uuid(),
  title: z.string().min(2),
  description: z.string().optional(),
  totalShares: z.number().int().positive(),
  pricePerShareKes: z.number().positive(),
  minInvestmentKes: z.number().positive().optional(),
  maxInvestmentKes: z.number().positive().optional(),
  closesAt: z.string().datetime().optional(),
  terms: z.string().optional(),
});

router.post("/chamas/:id/offerings", authenticate, validate(createOfferingSchema), async (req, res) => {
  const chamaId = req.params.id;
  const membership = await prisma.membership.findFirst({
    where: { userId: req.user!.userId, chamaId, role: { in: ["owner", "admin", "treasurer"] } },
  });
  if (!membership) throw ApiError.forbidden("Only officers can create offerings");
  const off = await offering.createOffering({ ...req.body, chamaId, createdById: req.user!.userId });
  success(res, off);
});

router.get("/chamas/:id/offerings", authenticate, async (req, res) => {
  success(res, await offering.listOfferings(req.params.id));
});

router.post("/chamas/:id/offerings/:offeringId/close", authenticate, async (req, res) => {
  await offering.closeOffering(req.params.offeringId);
  success(res, { ok: true });
});

router.get("/chamas/:id/cap-table", authenticate, async (req, res) => {
  success(res, await offering.capTable(req.params.id));
});

const dividendSchema = z.object({ potKes: z.number().positive() });
router.post("/chamas/:id/dividends/declare", authenticate, validate(dividendSchema), async (req, res) => {
  const result = await offering.declareDividend(req.params.id, req.body.potKes);
  success(res, result);
});

export default router;
