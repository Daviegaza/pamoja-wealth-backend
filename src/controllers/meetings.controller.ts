import { Response, NextFunction } from "express";
import { Request } from "express";
import * as meetingService from "../services/meetings.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await meetingService.list(req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await meetingService.create(req.body, req.user!.userId);
    success(res, result, undefined, 201);
  } catch (err) { next(err); }
}

export async function rsvp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await meetingService.rsvp(req.params.id, req.user!.userId, req.body.status);
    success(res, result);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await meetingService.update(req.params.id, req.body);
    success(res, result);
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await meetingService.getById(req.params.id);
    success(res, result);
  } catch (err) { next(err); }
}

export async function saveMinutes(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await meetingService.saveMinutes(req.params.id, req.body.content, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}
