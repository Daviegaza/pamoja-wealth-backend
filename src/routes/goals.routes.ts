import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createGoalSchema, updateGoalSchema } from "../validators/goal.schema.js";
import * as goals from "../controllers/goals.controller.js";

const router = Router();

router.get("/", authenticate, goals.list);
router.post("/", authenticate, validate(createGoalSchema), goals.create);
router.patch("/:id", authenticate, validate(updateGoalSchema), goals.update);
router.delete("/:id", authenticate, goals.remove);

export default router;
