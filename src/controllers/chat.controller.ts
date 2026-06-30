import { Response, NextFunction } from "express";
import { Request } from "express";
import * as chatService from "../services/chat.service.js";
import { success } from "../utils/api-response.js";

export async function getMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const before = req.query.before as string | undefined;
    const limit = parseInt((req.query.limit as string) || "50", 10);
    const messages = await chatService.getMessages(req.params.id, before, limit);
    success(res, { messages });
  } catch (err) { next(err); }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const message = await chatService.sendMessage(
      req.params.id,
      req.user!.userId,
      req.body.content
    );
    success(res, { message }, undefined, 201);
  } catch (err) { next(err); }
}
