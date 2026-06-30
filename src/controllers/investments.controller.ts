import { Response, NextFunction } from "express";
import { Request } from "express";
import * as investmentService from "../services/investments.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await investmentService.list(req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await investmentService.create(req.body);
    success(res, result, undefined, 201);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await investmentService.update(req.params.id, req.body);
    success(res, result);
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await investmentService.getById(req.params.id);
    success(res, result);
  } catch (err) { next(err); }
}
