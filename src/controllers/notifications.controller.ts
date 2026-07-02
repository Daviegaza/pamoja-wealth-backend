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

export async function sendReminder(req: Request, res: Response, next: NextFunction) {
  try {
    const { chamaId, memberId, contributionId, amount, month } = req.body ?? {};
    const targetUserId: string = memberId ?? req.user!.userId;
    const title = "Contribution reminder";
    const message = `Reminder: your ${month ?? "monthly"} contribution of KES ${amount ?? 0} is due.`;
    const actionUrl = chamaId ? `/chamas/${chamaId}` : "/wallet";
    const notification = await notificationService.create(targetUserId, "info", title, message, actionUrl);
    success(res, { notificationId: notification.id, sent: true, contributionId });
  } catch (err) { next(err); }
}
