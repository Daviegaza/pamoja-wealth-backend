/**
 * Circuit-breaker admin routes.
 *
 *   GET  /chamas/:id/freeze/status   — read current freeze state
 *   POST /chamas/:id/freeze          — manual freeze (officer only)
 *   POST /chamas/:id/unfreeze        — clear (requires 2 officers + reason)
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";
import { freeze, unfreeze, getFreezeState } from "../services/circuit-breaker.service.js";

const router = Router();

router.get("/chamas/:id/freeze/status", authenticate, async (req, res, next) => {
  try {
    success(res, await getFreezeState(req.params.id));
  } catch (err) { next(err); }
});

const freezeSchema = z.object({ reason: z.string().min(5) });
router.post("/chamas/:id/freeze", authenticate, validate(freezeSchema), async (req, res, next) => {
  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: req.user!.userId, chamaId: req.params.id, role: { in: ["owner", "admin", "treasurer", "chairperson"] } },
    });
    if (!membership) throw ApiError.forbidden("Only chama officers can freeze");
    await freeze(req.params.id, req.body.reason, "manual", req.user!.userId);
    success(res, { ok: true });
  } catch (err) { next(err); }
});

const unfreezeSchema = z.object({
  reason: z.string().min(5),
  coSignerUserId: z.string().uuid(),
});
router.post("/chamas/:id/unfreeze", authenticate, validate(unfreezeSchema), async (req, res, next) => {
  try {
    const [me, co] = await Promise.all([
      prisma.membership.findFirst({
        where: { userId: req.user!.userId, chamaId: req.params.id, role: { in: ["owner", "admin", "treasurer", "chairperson"] } },
      }),
      prisma.membership.findFirst({
        where: { userId: req.body.coSignerUserId, chamaId: req.params.id, role: { in: ["owner", "admin", "treasurer", "chairperson"] } },
      }),
    ]);
    if (!me) throw ApiError.forbidden("Only officers can unfreeze");
    if (!co) throw ApiError.validation("Co-signer must be a distinct chama officer");
    if (co.userId === req.user!.userId) throw ApiError.validation("Co-signer cannot be the same user");
    await unfreeze(req.params.id, req.user!.userId, req.body.reason);
    success(res, { ok: true });
  } catch (err) { next(err); }
});

export default router;
