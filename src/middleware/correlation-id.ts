import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "../config/logger.js";

/**
 * Attaches a unique correlation ID to every request for distributed tracing.
 *
 * - If the caller sends `X-Correlation-Id`, it is reused (propagation).
 * - Otherwise a new UUIDv4 is generated.
 * - The ID is attached to `req`, the `X-Correlation-Id` response header,
 *   and every log statement produced during this request via a child logger.
 *
 * Usage (in app.ts, after helmet + before routes):
 *   app.use(correlationId);
 */

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function correlationId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-correlation-id"] as string) || randomUUID();
  req.correlationId = id;
  res.setHeader("X-Correlation-Id", id);

  // Attach a child logger so every log statement automatically carries the
  // correlation ID. Services that log via `logger` won't pick this up — they
  // should use `req.log` or pass correlationId explicitly.
  (req as any).log = logger.child({ correlationId: id });

  next();
}
