import { Request, Response, NextFunction } from "express";
import * as usersService from "../services/users.service.js";
import { success } from "../utils/api-response.js";

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.getProfile(req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.updateProfile(req.user!.userId, req.body);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.getProfile(req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getPublicProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.getPublicProfile(req.params.id);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function searchUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const q = (req.query.q as string) || "";
    const chamaId = req.query.chamaId as string | undefined;
    const users = await usersService.searchUsers(q, chamaId);
    success(res, { users });
  } catch (err) {
    next(err);
  }
}
