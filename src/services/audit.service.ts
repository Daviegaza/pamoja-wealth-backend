import crypto from "crypto";
import { prisma } from "../config/database.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { RequestContext } from "../utils/http.js";
import { getPaginationMeta } from "../utils/pagination.js";

export type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  chamaId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Append a tamper-evident audit entry. Must be called INSIDE the same
 * transaction as the record change it describes, so a change can never be
 * committed without its audit row.
 *
 * Entries are hash-chained per chama: hash = sha256(prevHash | entry JSON).
 * A per-chama advisory lock serialises writers so the chain stays linear.
 */
export async function recordAudit(tx: Tx, ctx: RequestContext | null, entry: AuditEntry): Promise<void> {
  const scope = entry.chamaId ?? "platform";
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit:${scope}`}))`;

  const prev = await tx.auditLog.findFirst({
    where: { chamaId: entry.chamaId },
    orderBy: { createdAt: "desc" },
    select: { hash: true, createdAt: true },
  });

  // Strictly increasing timestamps per chain (we hold the lock), so ordering
  // by createdAt always reproduces the chain even within one millisecond.
  const now = Date.now();
  const createdAt = new Date(prev && prev.createdAt.getTime() >= now ? prev.createdAt.getTime() + 1 : now);
  const id = crypto.randomUUID();
  const payload = JSON.stringify({
    id,
    chamaId: entry.chamaId,
    userId: ctx?.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    details: entry.details ?? null,
    createdAt: createdAt.toISOString(),
  });
  const hasher = crypto.createHash("sha256");
  if (prev?.hash) hasher.update(Buffer.from(prev.hash));
  hasher.update(payload);
  const hash = hasher.digest();

  await tx.auditLog.create({
    data: {
      id,
      chamaId: entry.chamaId,
      userId: ctx?.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      prevHash: prev?.hash ? Buffer.from(prev.hash) : null,
      hash,
      createdAt,
    },
  });
}

export async function listForChama(chamaId: string, page: number, pageSize: number) {
  const where = { chamaId };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { fullName: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  // IP address / user agent are deliberately not exposed to chama members.
  const items = rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actorName: r.user?.fullName ?? null,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  }));
  return { items, meta: getPaginationMeta(total, page, pageSize) };
}
