import { Router, type Request, type Response, type NextFunction } from "express";
import { authenticate } from "../middleware/auth.js";
import * as notificationService from "../services/notifications.service.js";
import { success } from "../utils/api-response.js";

const router = Router();

router.post("/tickets", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subject, description } = req.body ?? {};
    if (!subject || !description) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "subject and description are required" },
      });
    }
    const ticketId = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await notificationService.create(
      req.user!.userId,
      "info",
      "Support ticket received",
      `Ticket ${ticketId}: "${String(subject).slice(0, 60)}". We'll reply within 24 hours.`,
      "/support",
    );
    success(res, { ticketId, subject, status: "open" });
  } catch (err) {
    next(err);
  }
});

export default router;
