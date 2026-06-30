import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requirePermission } from "../middleware/permissions.js";
import { createLoanSchema, repayLoanSchema, loanQuerySchema } from "../validators/loan.schema.js";
import * as loans from "../controllers/loans.controller.js";

const router = Router();

router.get("/", authenticate, validate(loanQuerySchema, "query"), loans.list);
router.post("/", authenticate, validate(createLoanSchema), loans.create);
router.post("/:id/approve", authenticate, requirePermission("approve_loans"), loans.approve);
router.post("/:id/reject", authenticate, requirePermission("approve_loans"), loans.reject);
router.get("/:id/repayments", authenticate, loans.getRepayments);
router.post("/:id/repay", authenticate, validate(repayLoanSchema), loans.repay);
router.get("/:id", authenticate, loans.getById);

export default router;
