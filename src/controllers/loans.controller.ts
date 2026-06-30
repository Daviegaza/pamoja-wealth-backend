import { Response, NextFunction } from "express";
import { Request } from "express";
import * as loanService from "../services/loans.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loanService.list(req.query as any, req.user?.userId);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loanService.create(req.body, req.user!.userId);
    success(res, result, undefined, 201);
  } catch (err) { next(err); }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loanService.approve(req.params.id, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function reject(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loanService.reject(req.params.id, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loanService.getById(req.params.id);
    success(res, result);
  } catch (err) { next(err); }
}

export async function getRepayments(req: Request, res: Response, next: NextFunction) {
  try {
    const repayments = await loanService.getRepayments(req.params.id);
    success(res, { repayments });
  } catch (err) { next(err); }
}

export async function repay(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loanService.repay(req.params.id, req.body.amount, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}
