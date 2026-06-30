import { Response, NextFunction } from "express";
import { Request } from "express";
import * as notificationService from "../services/notifications.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.list(req.user!.userId, req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
    res.locals.unreadCount = result.unreadCount;
  } catch (err) { next(err); }
}

export async function markAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.markAsRead(req.user!.userId, req.params.id);
    success(res, result);
  } catch (err) { next(err); }
}

export async function markAllAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.markAllAsRead(req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.remove(req.user!.userId, req.params.id);
    success(res, result);
  } catch (err) { next(err); }
}
