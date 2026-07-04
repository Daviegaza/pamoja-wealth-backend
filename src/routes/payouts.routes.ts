/**
 * Payout signature routes — multi-sig approval for PayoutRequest rows.
 *
 *   GET  /chamas/:id/payouts/pending     — list awaiting_signatures for chama
 *   GET  /payouts/:id                    — payout detail incl. signatures
 *   POST /payouts/:id/sign               — record a signature; enqueue when threshold met
 *   POST /payouts/:id/cancel             — creator/admin only, cancel before disburse
 *
 * Threshold logic: each PayoutRequest carries `requiredSignatures`. Once
 * count(PayoutSignature) >= threshold, status flips awaiting_signatures →
 * pending and the dividend-payout worker fires.
 *
 * `biometricToken` is the client-side attestation blob (WebAuthn or device
 * biometrics). Not verified server-side today — treated as an audit-only
 * record. Real cryptographic verification lands with the WebAuthn PR.
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";
import { dividendPayoutQueue } from "../jobs/queue.js";
import { logger } from "../config/logger.js";

const router = Router();

router.get("/chamas/:id/payouts/pending", authenticate, async (req, res) => {
  const chamaId = req.params.id;
  const membership = await prisma.membership.findFirst({
    where: { userId: req.user!.userId, chamaId, role: { in: ["owner", "admin", "treasurer"] } },
  });
  if (!membership) throw ApiError.forbidden("Only officers can view pending payouts");

  const payouts = await prisma.payoutRequest.findMany({
    where: { chamaId, status: { in: ["awaiting_signatures", "pending"] } },
    orderBy: { createdAt: "desc" },
    include: {
      recipient: { select: { fullName: true, avatarUrl: true } },
      signatures: { select: { signerUserId: true, signedAt: true } },
    },
  });
  success(res, payouts);
});

router.get("/payouts/:id", authenticate, async (req, res) => {
  const payout = await prisma.payoutRequest.findUnique({
    where: { id: req.params.id },
    include: {
      recipient: { select: { fullName: true, avatarUrl: true } },
      chama: { select: { id: true, name: true } },
      signatures: { include: { signer: { select: { fullName: true } } } },
    },
  });
  if (!payout) throw ApiError.notFound("Payout", req.params.id);
  const membership = await prisma.membership.findFirst({
    where: { userId: req.user!.userId, chamaId: payout.chamaId },
  });
  if (!membership) throw ApiError.forbidden("Not a member of this chama");
  success(res, payout);
});

const signSchema = z.object({
  biometricToken: z.string().min(1),
});

router.post("/payouts/:id/sign", authenticate, validate(signSchema), async (req, res) => {
  const payoutId = req.params.id;
  const signerUserId = req.user!.userId;

  const payout = await prisma.payoutRequest.findUnique({
    where: { id: payoutId },
    select: { id: true, chamaId: true, requiredSignatures: true, status: true, createdById: true },
  });
  if (!payout) throw ApiError.notFound("Payout", payoutId);
  if (payout.status !== "awaiting_signatures" && payout.status !== "pending") {
    throw ApiError.validation(`Payout already ${payout.status}`);
  }

  // Signer must be an active officer in the chama.
  const membership = await prisma.membership.findFirst({
    where: {
      userId: signerUserId,
      chamaId: payout.chamaId,
      role: { in: ["owner", "admin", "treasurer", "chairperson"] },
      status: "active",
    },
  });
  if (!membership) throw ApiError.forbidden("Only officers can sign");

  // Idempotent via @@unique([payoutId, signerUserId]) — catch and short-circuit.
  try {
    await prisma.payoutSignature.create({
      data: {
        payoutId,
        signerUserId,
        biometricToken: req.body.biometricToken.slice(0, 4096),
      },
    });
  } catch (err) {
    // Duplicate signature — treat as success.
    logger.info({ payoutId, signerUserId, err: (err as Error).message }, "sign: duplicate, ignoring");
  }

  const sigCount = await prisma.payoutSignature.count({ where: { payoutId } });
  let statusAfter = payout.status;
  let enqueued = false;

  if (sigCount >= payout.requiredSignatures && payout.status === "awaiting_signatures") {
    await prisma.payoutRequest.update({
      where: { id: payoutId },
      data: { status: "pending" },
    });
    await dividendPayoutQueue.add("dividend-payout", { payoutRequestId: payoutId });
    statusAfter = "pending";
    enqueued = true;
    logger.info({ payoutId, sigCount, threshold: payout.requiredSignatures }, "sign: threshold met, enqueued");
  }

  success(res, {
    payoutId,
    signaturesCollected: sigCount,
    threshold: payout.requiredSignatures,
    status: statusAfter,
    enqueued,
  });
});

router.post("/payouts/:id/cancel", authenticate, async (req, res) => {
  const payout = await prisma.payoutRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, chamaId: true, status: true, createdById: true },
  });
  if (!payout) throw ApiError.notFound("Payout", req.params.id);
  if (payout.status === "disbursing" || payout.status === "disbursed") {
    throw ApiError.validation("Payout already in flight — cannot cancel");
  }
  const isCreator = payout.createdById === req.user!.userId;
  const officer = await prisma.membership.findFirst({
    where: { userId: req.user!.userId, chamaId: payout.chamaId, role: { in: ["owner", "admin"] } },
  });
  if (!isCreator && !officer) throw ApiError.forbidden("Only creator or officer can cancel");

  await prisma.payoutRequest.update({
    where: { id: payout.id },
    data: { status: "cancelled" },
  });
  success(res, { ok: true });
});

export default router;
