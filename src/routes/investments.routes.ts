import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requirePermission } from "../middleware/permissions.js";
import { createInvestmentSchema, updateInvestmentSchema, investmentQuerySchema } from "../validators/investment.schema.js";
import * as investments from "../controllers/investments.controller.js";

const router = Router();

router.get("/", authenticate, validate(investmentQuerySchema, "query"), investments.list);
router.post("/", authenticate, requirePermission("manage_treasury"), validate(createInvestmentSchema), investments.create);
router.patch("/:id", authenticate, requirePermission("manage_treasury"), validate(updateInvestmentSchema), investments.update);
router.get("/:id", authenticate, investments.getById);

export default router;
