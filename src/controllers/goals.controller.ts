import { Response, NextFunction } from "express";
import { Request } from "express";
import * as goalService from "../services/goals.service.js";
import { success } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const goals = await goalService.list(req.user!.userId);
    success(res, { goals });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await goalService.create(req.body, req.user!.userId);
    success(res, result, undefined, 201);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await goalService.update(req.params.id, req.body, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await goalService.remove(req.params.id, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}
