import { prisma } from "../config/database.js";
import { Request } from "express";

export async function auditLog(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const userId = req.user?.userId;
    const chamaId = req.membership?.chamaId || (req.body?.chamaId as string | undefined);
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        ...(userId ? { userId } : {}),
        ...(chamaId ? { chamaId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(details ? { details: details as any } : {}),
        ...(req.ip ? { ipAddress: req.ip } : {}),
        userAgent: req.headers["user-agent"] || null,
      } as any,
    });
  } catch {
    // Audit failure should never block the main operation
  }
}
