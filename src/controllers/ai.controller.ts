import { Response, NextFunction } from "express";
import { Request } from "express";
import * as aiService from "../services/ai.service.js";
import { success } from "../utils/api-response.js";

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await aiService.chat(
      req.body.messages,
      req.user!.userId,
      req.body.chamaId
    );
    success(res, { message: result });
  } catch (err) { next(err); }
}

export async function getInsights(req: Request, res: Response, next: NextFunction) {
  try {
    const chamaId = req.query.chamaId as string;
    const insights = await aiService.getInsights(chamaId);
    success(res, { insights });
  } catch (err) { next(err); }
}

export async function getHealthScore(req: Request, res: Response, next: NextFunction) {
  try {
    const chamaId = req.query.chamaId as string;
    const result = await aiService.getHealthScore(chamaId);
    success(res, result);
  } catch (err) { next(err); }
}
