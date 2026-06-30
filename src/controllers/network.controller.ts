import { Response, NextFunction } from "express";
import { Request } from "express";
import * as networkService from "../services/network.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function getConnections(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await networkService.getConnections(req.user!.userId, req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
}

export async function getStats(req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await networkService.getStats(req.user!.userId);
    success(res, stats);
  } catch (err) { next(err); }
}

export async function getPrivacy(req: Request, res: Response, next: NextFunction) {
  try {
    const privacy = await networkService.getPrivacy(req.user!.userId);
    success(res, privacy);
  } catch (err) { next(err); }
}

export async function updatePrivacy(req: Request, res: Response, next: NextFunction) {
  try {
    const privacy = await networkService.updatePrivacy(req.user!.userId, req.body);
    success(res, privacy);
  } catch (err) { next(err); }
}
