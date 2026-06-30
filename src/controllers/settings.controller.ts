import { Response, NextFunction } from "express";
import { Request } from "express";
import * as settingsService from "../services/settings.service.js";
import { success } from "../utils/api-response.js";

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.get(req.user!.userId);
    success(res, settings);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.update(req.user!.userId, req.body);
    success(res, settings);
  } catch (err) { next(err); }
}
