/**
 * Extended routes for research-derived features.
 *
 *   POST /chamas/:id/bidding/open           — officer opens auction
 *   POST /chamas/:id/bidding/bid            — member submits sealed bid
 *   POST /chamas/:id/bidding/close          — officer closes + settles
 *   GET  /chamas/:id/bidding/:cycleId       — read current round
 *
 *   POST /vc/membership/:chamaId            — issue self VC (auth)
 *   POST /vc/trust-score                    — issue self trust VC
 *   POST /vc/kyc                            — issue self KYC VC
 *   GET  /.well-known/jwks.json             — public JWK set
 *
 *   POST /vault/usdc/quote                  — get KES→USDC quote
 *   POST /vault/usdc/execute                — execute a deposit
 *   POST /vault/usdc/withdraw/quote         — get USDC→KES quote
 *
 *   POST /chamas/:id/payouts/export/iso20022 — ISO 20022 pain.001 XML
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";
import { openBidRound, submitBid, closeBidRound, getBidRound } from "../services/bidding-payout.service.js";
import { issueMembershipCredential, issueTrustScoreCredential, issueKycCredential, publicJwks } from "../services/verifiable-credential.service.js";
import { quoteDeposit, executeDeposit, quoteWithdrawal } from "../services/payment-providers/yellowcard.js";
import { buildIso20022Pain001 } from "../services/iso20022-export.service.js";

const router = Router();

// ── Bidding payout ─────────────────────────────────────────────────
const openSchema = z.object({ cycleId: z.string().min(4), potKes: z.number().positive(), windowDays: z.number().int().min(1).max(30) });
router.post("/chamas/:id/bidding/open", authenticate, validate(openSchema), async (req, res, next) => {
  try {
    const officer = await prisma.membership.findFirst({
      where: { userId: req.user!.userId, chamaId: req.params.id, role: { in: ["owner", "admin", "treasurer"] } },
    });
    if (!officer) throw ApiError.forbidden("Officer only");
    const round = await openBidRound({
      chamaId: req.params.id,
      cycleId: req.body.cycleId,
      potKes: req.body.potKes,
      windowDays: req.body.windowDays,
    });
    success(res, round);
  } catch (err) { next(err); }
});

const bidSchema = z.object({ cycleId: z.string(), bidKes: z.number().positive() });
router.post("/chamas/:id/bidding/bid", authenticate, validate(bidSchema), async (req, res, next) => {
  try {
    const round = await submitBid({
      chamaId: req.params.id,
      cycleId: req.body.cycleId,
      userId: req.user!.userId,
      bidKes: req.body.bidKes,
    });
    success(res, round);
  } catch (err) { next(err); }
});

router.post("/chamas/:id/bidding/close", authenticate, async (req, res, next) => {
  try {
    const officer = await prisma.membership.findFirst({
      where: { userId: req.user!.userId, chamaId: req.params.id, role: { in: ["owner", "admin", "treasurer"] } },
    });
    if (!officer) throw ApiError.forbidden("Officer only");
    const result = await closeBidRound(req.params.id, String(req.body.cycleId ?? ""));
    success(res, result);
  } catch (err) { next(err); }
});

router.get("/chamas/:id/bidding/:cycleId", authenticate, async (req, res, next) => {
  try { success(res, await getBidRound(req.params.id, req.params.cycleId)); } catch (err) { next(err); }
});

// ── Verifiable Credentials ─────────────────────────────────────────
router.post("/vc/membership/:chamaId", authenticate, async (req, res, next) => {
  try { success(res, { jwt: await issueMembershipCredential(req.user!.userId, req.params.chamaId) }); } catch (err) { next(err); }
});
router.post("/vc/trust-score", authenticate, async (req, res, next) => {
  try { success(res, { jwt: await issueTrustScoreCredential(req.user!.userId) }); } catch (err) { next(err); }
});
router.post("/vc/kyc", authenticate, async (req, res, next) => {
  try { success(res, { jwt: await issueKycCredential(req.user!.userId) }); } catch (err) { next(err); }
});
router.get("/.well-known/jwks.json", (_req, res) => {
  res.json(publicJwks());
});

// ── USDC vault ─────────────────────────────────────────────────────
const usdcQuoteSchema = z.object({ amountKes: z.number().positive() });
router.post("/vault/usdc/quote", authenticate, validate(usdcQuoteSchema), async (req, res, next) => {
  try { success(res, await quoteDeposit(req.body.amountKes)); } catch (err) { next(err); }
});

const usdcExecSchema = z.object({ quoteId: z.string() });
router.post("/vault/usdc/execute", authenticate, validate(usdcExecSchema), async (req, res, next) => {
  try { success(res, await executeDeposit(req.body.quoteId)); } catch (err) { next(err); }
});

const usdcWdQuoteSchema = z.object({ usdcAmount: z.number().positive() });
router.post("/vault/usdc/withdraw/quote", authenticate, validate(usdcWdQuoteSchema), async (req, res, next) => {
  try { success(res, await quoteWithdrawal(req.body.usdcAmount)); } catch (err) { next(err); }
});

// ── ISO 20022 export ───────────────────────────────────────────────
router.get("/chamas/:id/payouts/export/iso20022", authenticate, async (req, res, next) => {
  try {
    const officer = await prisma.membership.findFirst({
      where: { userId: req.user!.userId, chamaId: req.params.id, role: { in: ["owner", "admin", "treasurer"] } },
    });
    if (!officer) throw ApiError.forbidden("Officer only");
    const chama = await prisma.chama.findUnique({ where: { id: req.params.id }, select: { name: true } });
    const payouts = await prisma.payoutRequest.findMany({
      where: { chamaId: req.params.id, status: { in: ["approved", "pending", "disbursed"] } },
      include: { recipient: { select: { fullName: true, phone: true } } },
      take: 200,
    });
    const { xml, filename } = buildIso20022Pain001({
      messageId: `PJ-${req.params.id.slice(0, 8)}-${Date.now()}`,
      initiatingParty: chama?.name ?? "Chama",
      debtorName: chama?.name ?? "Chama",
      debtorIban: `KE-${req.params.id.slice(0, 12)}`,
      transfers: payouts.map((p) => ({
        endToEndId: p.id,
        amountKes: Number(p.amount),
        debtorName: chama?.name ?? "Chama",
        debtorAccount: `KE-${req.params.id.slice(0, 12)}`,
        creditorName: p.recipient?.fullName ?? "Member",
        creditorAccount: p.recipient?.phone ?? p.recipientUserId,
        remittanceInfo: p.purpose,
      })),
    });
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) { next(err); }
});

export default router;
