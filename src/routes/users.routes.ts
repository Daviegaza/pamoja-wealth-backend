import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { updateProfileSchema } from "../validators/auth.schema.js";
import * as users from "../controllers/users.controller.js";
import * as auth from "../controllers/auth.controller.js";

const router = Router();

router.get("/me", authenticate, users.getMe);
router.patch("/me", authenticate, validate(updateProfileSchema), users.updateMe);
router.get("/me/profile", authenticate, users.getProfile);
router.post("/me/enable-2fa", authenticate, auth.enable2fa);
router.post("/me/verify-2fa", authenticate, auth.verify2fa);
router.get("/search", authenticate, users.searchUsers);
router.get("/:id", authenticate, users.getPublicProfile);

export default router;
