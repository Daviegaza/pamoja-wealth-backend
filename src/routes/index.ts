import { Router } from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./users.routes.js";
import chamaRoutes from "./chamas.routes.js";
import walletRoutes from "./wallet.routes.js";
import loanRoutes from "./loans.routes.js";
import investmentRoutes from "./investments.routes.js";
import meetingRoutes from "./meetings.routes.js";
import voteRoutes from "./votes.routes.js";
import chatRoutes from "./chat.routes.js";
import notificationRoutes from "./notifications.routes.js";
import documentRoutes from "./documents.routes.js";
import goalRoutes from "./goals.routes.js";
import settingsRoutes from "./settings.routes.js";
import networkRoutes from "./network.routes.js";
import aiRoutes from "./ai.routes.js";
import billingRoutes from "./billing.routes.js";
import supportRoutes from "./support.routes.js";
import dmRoutes from "./dm.routes.js";
import webhooksRouter from "./webhooks/mpesa-c2b.routes.js";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";

const router = Router();

// Health check
router.get("/health", async (_req, res) => {
  let dbStatus = "ok";
  let redisStatus = "ok";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  try {
    await redis.ping();
  } catch {
    redisStatus = "error";
  }

  res.json({
    success: true,
    data: {
      status: dbStatus === "ok" && redisStatus === "ok" ? "ok" : "degraded",
      uptime: process.uptime(),
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    },
  });
});

// Mount all route groups
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/chamas", chamaRoutes);
router.use("/wallet", walletRoutes);
router.use("/loans", loanRoutes);
router.use("/investments", investmentRoutes);
router.use("/meetings", meetingRoutes);
router.use("/votes", voteRoutes);
router.use("/chat", chatRoutes);
router.use("/notifications", notificationRoutes);
router.use("/documents", documentRoutes);
router.use("/goals", goalRoutes);
router.use("/settings", settingsRoutes);
router.use("/network", networkRoutes);
router.use("/ai", aiRoutes);
router.use("/billing", billingRoutes);
router.use("/support", supportRoutes);
router.use("/dm", dmRoutes);

// Webhooks live under /api/v1/webhooks/* (the app mounts everything under
// /api/v1 in src/app.ts). Path tokens deliberately avoid "mpesa"/"safaricom"
// because some intermediaries filter those — see webhooks/mpesa-c2b.routes.ts.
router.use("/webhooks", webhooksRouter);

export default router;
