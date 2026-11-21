import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter, otpResendLimiter, standardLimiter } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/http.js";
import { success, paginated } from "../utils/api-response.js";
import { paginationQuery } from "../validators/common.js";
import {
  registerSchema, loginSchema, verifyOtpSchema, resendOtpSchema, forgotPasswordSchema,
  resetPasswordSchema, refreshSchema, enable2faSchema, verify2faSchema, logoutSchema, updateProfileSchema,
} from "../validators/auth.schema.js";
import { updateSettingsSchema } from "../validators/settings.schema.js";
import * as auth from "../services/auth.service.js";
import * as users from "../services/users.service.js";
import * as settings from "../services/settings.service.js";
import * as notifications from "../services/notifications.service.js";
import * as billing from "../services/billing.service.js";
import chamaRoutes from "./chamas.routes.js";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { metricsEndpoint } from "../config/metrics.js";
import { config } from "../config/index.js";

const router = Router();
router.use(standardLimiter);

router.get("/health", asyncHandler(async (_req, res) => {
  const [db, cache] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok", () => "error"),
    Promise.resolve(redis.ping()).then(() => "ok", () => "error"),
  ]);
  res.json({
    success: true,
    data: { status: db === "ok" && cache === "ok" ? "ok" : "degraded", db, redis: cache, timestamp: new Date().toISOString() },
  });
}));

// Metrics: open in development, bearer-token protected in production
// (disabled entirely if METRICS_TOKEN is not set).
router.get("/metrics", (req, res, next) => {
  if (!config.isProduction) return metricsEndpoint(req, res, next);
  const token = config.metrics.token;
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    res.status(404).end();
    return;
  }
  metricsEndpoint(req, res, next);
});

// ── Auth ──────────────────────────────────────────────────────────────
const authRouter = Router();
authRouter.post("/register", authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  success(res, await auth.register(req.body), undefined, 201);
}));
authRouter.post("/login", authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  success(res, await auth.login(req.body.email, req.body.password));
}));
authRouter.post("/verify-otp", authLimiter, validate(verifyOtpSchema), asyncHandler(async (req, res) => {
  success(res, await auth.verifyOtpFlow(req.body.userId, req.body.code));
}));
authRouter.post("/resend-otp", otpResendLimiter, validate(resendOtpSchema), asyncHandler(async (req, res) => {
  success(res, await auth.resendOtpFlow(req.body.userId));
}));
authRouter.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), asyncHandler(async (req, res) => {
  success(res, await auth.forgotPassword(req.body.email));
}));
authRouter.post("/reset-password", authLimiter, validate(resetPasswordSchema), asyncHandler(async (req, res) => {
  success(res, await auth.resetPassword(req.body.token, req.body.newPassword));
}));
authRouter.post("/refresh", validate(refreshSchema), asyncHandler(async (req, res) => {
  success(res, await auth.refresh(req.body.refreshToken));
}));
authRouter.post("/logout", authenticate, validate(logoutSchema), asyncHandler(async (req, res) => {
  success(res, await auth.logout(req.user!.userId, req.body.refreshToken, req.body.allSessions ?? false));
}));
authRouter.post("/enable-2fa", authenticate, validate(enable2faSchema), asyncHandler(async (req, res) => {
  success(res, await auth.enable2fa(req.user!.userId, req.body.password));
}));
authRouter.post("/verify-2fa", authenticate, validate(verify2faSchema), asyncHandler(async (req, res) => {
  success(res, await auth.verify2fa(req.user!.userId, req.body.code));
}));
router.use("/auth", authRouter);

// ── Current user ──────────────────────────────────────────────────────
router.get("/users/me", authenticate, asyncHandler(async (req, res) => {
  success(res, await users.getProfile(req.user!.userId));
}));
router.patch("/users/me", authenticate, validate(updateProfileSchema), asyncHandler(async (req, res) => {
  success(res, await users.updateProfile(req.user!.userId, req.body));
}));
router.get("/settings", authenticate, asyncHandler(async (req, res) => {
  success(res, await settings.get(req.user!.userId));
}));
router.patch("/settings", authenticate, validate(updateSettingsSchema), asyncHandler(async (req, res) => {
  success(res, await settings.update(req.user!.userId, req.body));
}));

// ── Notifications (always scoped to the caller) ───────────────────────
router.get("/notifications", authenticate, validate(paginationQuery, "query"), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; pageSize: number; unreadOnly?: string };
  const result = await notifications.list(req.user!.userId, q);
  paginated(res, result.items, result.total, result.page, result.pageSize);
}));
router.post("/notifications/read-all", authenticate, asyncHandler(async (req, res) => {
  success(res, await notifications.markAllAsRead(req.user!.userId));
}));
router.post("/notifications/:id/read", authenticate, asyncHandler(async (req, res) => {
  await notifications.markAsRead(req.user!.userId, req.params.id);
  success(res, { read: true });
}));
router.delete("/notifications/:id", authenticate, asyncHandler(async (req, res) => {
  success(res, await notifications.remove(req.user!.userId, req.params.id));
}));

// ── Billing catalogue (public) ────────────────────────────────────────
router.get("/billing/plans", asyncHandler(async (_req, res) => {
  success(res, await billing.listPlans());
}));

// ── Chamas (all per-chama authorization lives in chamas.routes.ts) ────
router.use("/chamas", chamaRoutes);

export default router;
