import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import jwt from "jsonwebtoken";
const { JsonWebTokenError, TokenExpiredError, NotBeforeError } = jwt;
import { ApiError } from "../utils/api-error.js";
import { ErrorCode } from "../utils/error-codes.js";
import { logger } from "../config/logger.js";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // ── ApiError (our own) ─────────────────────────────────────────────
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  }

  // ── Zod validation errors ──────────────────────────────────────────
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".");
      if (!details[path]) details[path] = [];
      details[path].push(issue.message);
    }
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "Request validation failed",
        details,
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  }

  // ── JWT errors ─────────────────────────────────────────────────────
  if (err instanceof TokenExpiredError) {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.TOKEN_EXPIRED,
        message: "Token has expired",
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  }

  if (err instanceof JsonWebTokenError) {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: "Invalid or expired token",
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  }

  // ── Unknown errors ─────────────────────────────────────────────────
  logger.error({ err, correlationId: req.correlationId }, "Unhandled error");
  return res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: "An unexpected error occurred",
      ...(req.correlationId ? { correlationId: req.correlationId } : {}),
    },
  });
}
