import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Wrap an async route handler so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Request metadata recorded alongside audit entries. */
export interface RequestContext {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    userId: req.user!.userId,
    ip: req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string | undefined)?.slice(0, 512) ?? null,
  };
}
