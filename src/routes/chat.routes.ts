import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import * as chat from "../controllers/chat.controller.js";

const router = Router();

router.get("/chamas/:id/messages", authenticate, chat.getMessages);
router.post("/chamas/:id/messages", authenticate, chat.sendMessage);

export default router;
