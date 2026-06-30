import { Request, Response, NextFunction } from "express";
import * as contributeService from "../services/contribute.service.js";
import { success } from "../utils/api-response.js";

/**
 * Thin HTTP layer for `POST /api/v1/chamas/:id/contribute` and
 * `POST /api/v1/chamas/:id/donate-now`. All business logic lives in
 * `contribute.service.ts`.
 */

export async function contribute(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await contributeService.contribute({
      chamaId: req.params.id,
      userId: req.user!.userId,
      amount: Number(req.body.amount),
    });
    success(res, result, undefined, 202);
  } catch (err) {
    next(err);
  }
}

export async function donateNow(req: Request, res: Response, next: NextFunction) {
  try {
    const authed = !!req.user?.userId;
    const result = await contributeService.donate({
      chamaId: req.params.id,
      amount: Number(req.body.amount),
      userId: authed ? req.user!.userId : undefined,
      phone: !authed ? (req.body.phone as string | undefined) : undefined,
      name: req.body.name,
      message: req.body.message,
      isAnonymous: req.body.isAnonymous,
    });
    success(res, result, undefined, 202);
  } catch (err) {
    next(err);
  }
}
