import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import * as notifications from "../controllers/notifications.controller.js";

const router = Router();

router.get("/", authenticate, notifications.list);
router.post("/:id/read", authenticate, notifications.markAsRead);
router.post("/read-all", authenticate, notifications.markAllAsRead);
router.delete("/:id", authenticate, notifications.remove);

export default router;
