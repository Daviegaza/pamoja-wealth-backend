import { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service.js";
import { success } from "../utils/api-response.js";

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.register(req.body);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.login(req.body.email, req.body.password);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.verifyOtpFlow(req.body.userId, req.body.code);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function resendOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.resendOtpFlow(req.body.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.forgotPassword(req.body.email);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.resetPassword(req.body.token, req.body.newPassword);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.refresh(req.body.refreshToken);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.logout(req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function enable2fa(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.enable2fa(req.user!.userId, req.body.password);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function verify2fa(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.verify2fa(req.user!.userId, req.body.code);
    success(res, result);
  } catch (err) {
    next(err);
  }
}
