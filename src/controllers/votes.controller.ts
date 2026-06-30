import { Response, NextFunction } from "express";
import { Request } from "express";
import * as voteService from "../services/votes.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await voteService.list(req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await voteService.create(req.body, req.user!.userId);
    success(res, result, undefined, 201);
  } catch (err) { next(err); }
}

export async function castVote(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await voteService.castVote(req.params.id, req.body.optionId, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await voteService.getById(req.params.id, req.user?.userId);
    success(res, result);
  } catch (err) { next(err); }
}

export async function close(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await voteService.close(req.params.id);
    success(res, result);
  } catch (err) { next(err); }
}

export async function getResults(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await voteService.getResults(req.params.id);
    success(res, result);
  } catch (err) { next(err); }
}
