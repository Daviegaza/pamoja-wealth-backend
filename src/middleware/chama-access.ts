import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import type { Role } from "../types/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-chama authorization, step 1: the caller must be an ACTIVE member of the
 * chama named by the `:chamaId` route param, and the chama must not be
 * archived. Non-members get 404 so chama ids cannot be probed.
 *
 * Every chama-scoped router is mounted under `/chamas/:chamaId` and runs this
 * middleware first; every child resource (loan, contribution, meeting...) is
 * then looked up with `where: { id, chamaId }` so an id from another chama is
 * also a 404.
 */
export async function requireChamaMember(req: Request, _res: Response, next: NextFunction) {
  try {
    const chamaId = req.params.chamaId;
    const userId = req.user?.userId;
    if (!userId) return next(ApiError.unauthorized());
    if (!chamaId || !UUID_RE.test(chamaId)) return next(ApiError.notFound("Chama"));

    const membership = await prisma.membership.findUnique({
      where: { userId_chamaId: { userId, chamaId } },
      select: {
        id: true,
        userId: true,
        chamaId: true,
        role: true,
        status: true,
        chama: { select: { status: true } },
      },
    });

    if (!membership || membership.status !== "active" || membership.chama.status === "archived") {
      return next(ApiError.notFound("Chama"));
    }

    req.membership = {
      id: membership.id,
      userId: membership.userId,
      chamaId: membership.chamaId,
      role: membership.role,
      status: membership.status,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Per-chama authorization, step 2: the caller's role in THIS chama must be one
 * of `roles`. Must run after requireChamaMember.
 */
export function requireChamaRole(roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.membership?.role as Role | undefined;
    if (!req.membership) return next(ApiError.notFound("Chama"));
    if (!role || !roles.includes(role)) {
      return next(ApiError.forbidden("Your role in this chama does not allow this action"));
    }
    next();
  };
}

/** Validates that a child-resource route param is a UUID (else 404). */
export function requireUuidParam(name: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req.params[name];
    if (!value || !UUID_RE.test(value)) return next(ApiError.notFound("Record"));
    next();
  };
}
