/**
 * Public impact + financial-literacy endpoints (no auth).
 *
 *   GET /public/impact             — aggregate scoreboard (cached 10min)
 *   GET /public/lessons            — micro-lesson index
 *   GET /public/lessons/:slug      — single lesson
 *   POST /public/lessons/:slug/complete — (authed) record completion
 */
import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { success } from "../utils/api-response.js";
import { getImpactSnapshot } from "../services/impact.service.js";
import { getLessonIndex, getLesson, recordCompletion } from "../services/literacy.service.js";

const router = Router();

router.get("/public/impact", async (_req, res, next) => {
  try { success(res, await getImpactSnapshot()); } catch (err) { next(err); }
});

router.get("/public/lessons", (_req, res) => {
  success(res, getLessonIndex());
});

router.get("/public/lessons/:slug", (req, res, next) => {
  try {
    const lesson = getLesson(req.params.slug);
    if (!lesson) throw Object.assign(new Error("Lesson not found"), { statusCode: 404, code: "NOT_FOUND" });
    success(res, lesson);
  } catch (err) { next(err); }
});

router.post("/public/lessons/:slug/complete", authenticate, async (req, res, next) => {
  try {
    await recordCompletion(req.user!.userId, req.params.slug);
    success(res, { ok: true });
  } catch (err) { next(err); }
});

export default router;
