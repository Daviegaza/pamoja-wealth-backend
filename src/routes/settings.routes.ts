import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { updateSettingsSchema } from "../validators/settings.schema.js";
import * as settings from "../controllers/settings.controller.js";

const router = Router();

router.get("/", authenticate, settings.get);
router.patch("/", authenticate, validate(updateSettingsSchema), settings.update);

export default router;
