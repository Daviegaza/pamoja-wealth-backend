/**
 * Trust Score routes — portable credit passport.
 *
 *   GET /trust-score/me            — Full breakdown for authenticated user.
 *   GET /trust-score/:userId       — Public projection (score + band only).
 *   POST /trust-score/me/refresh   — Force recompute (skip cache).
 */
import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { getTrustScore, toPublic } from "../services/trust-score.service.js";
import { hasUserFeature } from "../services/feature-gate.service.js";

const router = Router();

router.get("/trust-score/me", authenticate, async (req, res, next) => {
  try {
    const result = await getTrustScore(req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
});

router.get("/trust-score/:userId", authenticate, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!userId) throw ApiError.validation("userId required");
    // Non-self lookups (partner SACCO / lender / insurer / etc.) require
    // API access on the caller's plan. This monetises the credit-passport.
    if (userId !== req.user!.userId) {
      const ok = await hasUserFeature(req.user!.userId, "api_access");
      if (!ok) {
        res.status(402).json({
          success: false,
          error: {
            code: "UPGRADE_REQUIRED",
            message: 'Third-party trust-score lookup requires the ENTERPRISE plan.',
            feature: "api_access",
            requiredPlan: "enterprise",
            upgradeUrl: "/pricing?target=enterprise",
          },
        });
        return;
      }
    }
    const result = await getTrustScore(userId);
    if (userId === req.user!.userId) {
      success(res, result);
    } else {
      success(res, toPublic(result));
    }
  } catch (err) {
    next(err);
  }
});

router.post("/trust-score/me/refresh", authenticate, async (req, res, next) => {
  try {
    const result = await getTrustScore(req.user!.userId, { skipCache: true });
    success(res, result);
  } catch (err) {
    next(err);
  }
});

export default router;
