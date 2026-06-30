import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { requireFeature } from "../middleware/plan-gate.js";
import * as ai from "../controllers/ai.controller.js";
import * as aiRules from "../controllers/ai-rules.controller.js";
import { compileRuleSchema, backTranslateRuleSchema } from "../validators/rule.schema.js";

const router = Router();

router.post("/chat", authenticate, aiLimiter, ai.chat);
router.post("/insights", authenticate, ai.getInsights);
router.post("/health-score", authenticate, ai.getHealthScore);

// Rule-engine compiler endpoints (RESEARCH_DOSSIER §6.10). Behind the same
// aiLimiter as /chat — these calls hit Claude and have non-trivial cost.
// Plan-gated: requires Starter+ (ai_rule_compiler feature).
router.post(
  "/rules/compile",
  authenticate,
  aiLimiter,
  validate(compileRuleSchema),
  requireFeature("ai_rule_compiler"),
  aiRules.compile,
);
router.post(
  "/rules/back-translate",
  authenticate,
  aiLimiter,
  validate(backTranslateRuleSchema),
  requireFeature("ai_rule_compiler"),
  aiRules.backTranslate,
);

// WhatsApp bot template management — Pro tier only. Stub endpoint until
// the WhatsApp Cloud API integration lands.
router.get(
  "/whatsapp/templates",
  authenticate,
  requireFeature("whatsapp_bot"),
  (_req, res) => res.json({ success: true, data: { templates: [] } }),
);

export default router;
