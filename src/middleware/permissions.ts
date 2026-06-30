import { Response, NextFunction, Request } from "express";
import { prisma } from "../config/database.js";
import { Permission, Role, ROLE_PERMISSIONS } from "../types/index.js";
import { ApiError } from "../utils/api-error.js";

export function requirePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const chamaId = req.params.chamaId || req.params.id || req.body?.chamaId;
    const userId = req.user!.userId;

    if (!chamaId) {
      return next(ApiError.validation("chamaId is required for permission check"));
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_chamaId: { userId, chamaId } },
    });

    if (!membership) {
      return next(ApiError.forbidden("Not a member of this chama"));
    }

    const permissions = ROLE_PERMISSIONS[membership.role as Role];
    if (!permissions.includes(permission)) {
      return next(ApiError.forbidden(`Missing required permission: ${permission}`));
    }

    req.membership = membership;
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const chamaId = req.params.chamaId || req.params.id || req.body?.chamaId;
    const userId = req.user!.userId;

    if (!chamaId) {
      return next(ApiError.validation("chamaId is required"));
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_chamaId: { userId, chamaId } },
    });

    if (!membership) {
      return next(ApiError.forbidden("Not a member of this chama"));
    }

    if (!roles.includes(membership.role as Role)) {
      return next(ApiError.forbidden(
        `This action requires one of these roles: ${roles.join(", ")}`
      ));
    }

    req.membership = membership;
    next();
  };
}
