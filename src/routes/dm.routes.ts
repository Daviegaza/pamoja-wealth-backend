import { Router, type Request, type Response, type NextFunction } from "express";
import { authenticate } from "../middleware/auth.js";
import * as dm from "../services/dm.service.js";
import { success } from "../utils/api-response.js";

const router = Router();

router.get("/conversations", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const conversations = await dm.listConversations(req.user!.userId);
    success(res, { conversations });
  } catch (err) { next(err); }
});

router.get("/:peerId/messages", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messages = await dm.getMessages(req.user!.userId, req.params.peerId);
    success(res, { messages });
  } catch (err) { next(err); }
});

router.post("/:peerId/messages", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body ?? {};
    if (!content || typeof content !== "string") {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "content is required" } });
    }
    const message = await dm.send(req.user!.userId, req.params.peerId, content);
    success(res, { message }, undefined, 201);
  } catch (err) { next(err); }
});

router.post("/:peerId/read", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dm.markRead(req.user!.userId, req.params.peerId);
    success(res, result);
  } catch (err) { next(err); }
});

export default router;
