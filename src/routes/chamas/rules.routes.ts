import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import { publishRuleSchema } from "../../validators/rule.schema.js";
import * as chamaRules from "../../controllers/chama-rules.controller.js";

// Mounted at /api/v1/chamas/:id/rules from chamas.routes.ts.
// mergeParams=true so `:id` from the parent router is visible here.
const router = Router({ mergeParams: true });

router.get("/", authenticate, chamaRules.list);
router.get("/active", authenticate, chamaRules.active);
router.get("/:version", authenticate, chamaRules.getVersion);
router.post(
  "/",
  authenticate,
  requirePermission("manage_settings"),
  validate(publishRuleSchema),
  chamaRules.publish
);

export default router;
