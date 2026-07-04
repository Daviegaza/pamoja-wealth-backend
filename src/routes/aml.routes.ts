/**
 * AML routes — admin + compliance-officer surface.
 *
 *   POST /aml/screen/me              — screen current user
 *   POST /aml/screen/:userId         — admin-only, force-refresh a user
 *   POST /aml/lists/refresh          — admin, fetch OFAC/UN/EU + reload Redis
 *   POST /aml/pep/import             — admin, seed PEP names (body: {names: []})
 *   POST /aml/tx/:transactionId/evaluate — run monitoring rules against a tx
 *   GET  /aml/strs                   — compliance list (open|submitted|closed)
 *   POST /aml/strs/:id/sar-draft     — build SAR draft for review
 *   POST /aml/strs/:id/submit        — mark submitted (attach FRC reference)
 *   POST /aml/strs/:id/close         — close STR with disposition
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";
import * as aml from "../services/aml.service.js";

const router = Router();

async function requireAdmin(userId: string): Promise<void> {
  const m = await prisma.membership.findFirst({
    where: { userId, role: { in: ["owner", "admin"] } },
    select: { id: true },
  });
  if (!m) throw ApiError.forbidden("Compliance admin only");
}

router.post("/aml/screen/me", authenticate, async (req, res, next) => {
  try { success(res, await aml.screenUser(req.user!.userId)); } catch (err) { next(err); }
});

router.post("/aml/screen/:userId", authenticate, async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    success(res, await aml.screenUser(req.params.userId, { skipCache: true }));
  } catch (err) { next(err); }
});

router.post("/aml/lists/refresh", authenticate, async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    success(res, await aml.refreshSanctionLists());
  } catch (err) { next(err); }
});

const importSchema = z.object({ names: z.array(z.string().min(2)).max(50_000) });
router.post("/aml/pep/import", authenticate, validate(importSchema), async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    success(res, await aml.importPepList(req.body.names));
  } catch (err) { next(err); }
});

router.post("/aml/tx/:transactionId/evaluate", authenticate, async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    const tx = await prisma.transaction.findUnique({
      where: { id: req.params.transactionId },
      select: { id: true, userId: true, amount: true, method: true, createdAt: true },
    });
    if (!tx || !tx.userId) throw ApiError.notFound("Transaction", req.params.transactionId);
    const hits = await aml.evaluateTransaction({
      userId: tx.userId,
      transactionId: tx.id,
      amountKes: Number(tx.amount),
      method: tx.method ?? "unknown",
      createdAt: tx.createdAt,
    });
    success(res, { transactionId: tx.id, hits });
  } catch (err) { next(err); }
});

router.get("/aml/strs", authenticate, async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    const status = (req.query.status as "open" | "submitted" | "closed_false_positive" | undefined) ?? "open";
    const rows = await prisma.suspiciousTransactionReport.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { subject: { select: { fullName: true, phone: true } } },
    });
    success(res, rows);
  } catch (err) { next(err); }
});

router.post("/aml/strs/:id/sar-draft", authenticate, async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    success(res, await aml.draftSar(req.params.id, req.user!.userId));
  } catch (err) { next(err); }
});

router.post("/aml/strs/:id/submit", authenticate, async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    await prisma.suspiciousTransactionReport.update({
      where: { id: req.params.id },
      data: { status: "submitted", submittedAt: new Date() },
    });
    success(res, { ok: true });
  } catch (err) { next(err); }
});

router.post("/aml/strs/:id/close", authenticate, async (req, res, next) => {
  try {
    await requireAdmin(req.user!.userId);
    await prisma.suspiciousTransactionReport.update({
      where: { id: req.params.id },
      data: { status: "closed_false_positive", closedAt: new Date() },
    });
    success(res, { ok: true });
  } catch (err) { next(err); }
});

export default router;
