import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Attaches a correlation ID to every request (reused from a well-formed
 * `X-Correlation-Id` header, otherwise generated) and echoes it back.
 */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-correlation-id"];
  const id = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader("X-Correlation-Id", id);
  next();
}
