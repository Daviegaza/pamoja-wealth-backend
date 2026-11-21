import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ApiError } from "../utils/api-error.js";
import { parseDateOnly, toAmount, toDateOnly } from "../utils/format.js";
import { getPaginationMeta } from "../utils/pagination.js";
import type { RequestContext } from "../utils/http.js";
import { isOfficer } from "../types/index.js";
import { recordAudit, type Tx } from "./audit.service.js";
import * as notifications from "./notifications.service.js";

/**
 * Contribution records. The treasurer (or chairperson) RECORDS a payment that
 * a member made directly to the chama's own Paybill/Till/bank account; the
 * member can then confirm or dispute the entry. Pamoja never receives money.
 *
 * Records are never edited or deleted: mistakes are voided (with a reason)
 * and re-recorded, and every state change is written to the audit log.
 */

const include = {
  member: { select: { fullName: true } },
  recordedBy: { select: { fullName: true } },
} as const;

type Row = Prisma.ContributionRecordGetPayload<{ include: typeof include }>;

export function toContributionDTO(r: Row) {
  return {
    id: r.id,
    chamaId: r.chamaId,
    memberId: r.memberId,
    memberName: r.member.fullName,
    amount: toAmount(r.amount),
    paidOn: toDateOnly(r.paidOn),
    method: r.method,
    mpesaReceipt: r.mpesaReceipt,
    note: r.note,
    scheduleId: r.scheduleId,
    goalId: r.goalId,
    status: r.status,
    disputeReason: r.disputeReason,
    voidReason: r.voidReason,
    recordedById: r.recordedById,
    recordedByName: r.recordedBy.fullName,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── Schedules ─────────────────────────────────────────────────────────

type ScheduleRow = Prisma.ContributionScheduleGetPayload<object>;

function toScheduleDTO(s: ScheduleRow) {
  return {
    id: s.id,
    name: s.name,
    amount: toAmount(s.amount),
    frequency: s.frequency,
    startDate: toDateOnly(s.startDate),
    dueDay: s.dueDay,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listSchedules(chamaId: string) {
  const rows = await prisma.contributionSchedule.findMany({ where: { chamaId }, orderBy: { createdAt: "desc" } });
  return rows.map(toScheduleDTO);
}

interface ScheduleInput {
  name: string;
  amount: number;
  frequency: "weekly" | "monthly" | "one_off";
  startDate: string;
  dueDay?: number;
  isActive: boolean;
}

export async function createSchedule(ctx: RequestContext, chamaId: string, input: ScheduleInput) {
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.contributionSchedule.create({
      data: {
        chamaId,
        name: input.name,
        amount: input.amount,
        frequency: input.frequency,
        startDate: parseDateOnly(input.startDate),
        dueDay: input.dueDay ?? null,
        isActive: input.isActive,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "schedule.created",
      entityType: "contribution_schedule",
      entityId: created.id,
      details: { ...input },
    });
    return created;
  });
  return toScheduleDTO(row);
}

export async function updateSchedule(ctx: RequestContext, chamaId: string, scheduleId: string, input: Partial<ScheduleInput>) {
  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.contributionSchedule.findFirst({ where: { id: scheduleId, chamaId } });
    if (!existing) throw ApiError.notFound("Schedule");
    const updated = await tx.contributionSchedule.update({
      where: { id: scheduleId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.frequency !== undefined && { frequency: input.frequency }),
        ...(input.startDate !== undefined && { startDate: parseDateOnly(input.startDate) }),
        ...(input.dueDay !== undefined && { dueDay: input.dueDay }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "schedule.updated",
      entityType: "contribution_schedule",
      entityId: scheduleId,
      details: { before: toScheduleDTO(existing), changes: input },
    });
    return updated;
  });
  return toScheduleDTO(row);
}

// ── Records ───────────────────────────────────────────────────────────

export interface ListQuery {
  memberId?: string;
  status?: "recorded" | "confirmed" | "disputed" | "voided";
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export function buildWhere(chamaId: string, query: Omit<ListQuery, "page" | "pageSize">): Prisma.ContributionRecordWhereInput {
  return {
    chamaId,
    ...(query.memberId && { memberId: query.memberId }),
    ...(query.status && { status: query.status }),
    ...((query.from || query.to) && {
      paidOn: {
        ...(query.from && { gte: parseDateOnly(query.from) }),
        ...(query.to && { lte: parseDateOnly(query.to) }),
      },
    }),
  };
}

export async function list(chamaId: string, viewer: { userId: string; role: string }, query: ListQuery) {
  // Members only ever see their own records; officers may filter by member.
  const memberId = isOfficer(viewer.role) ? query.memberId : viewer.userId;
  const where = buildWhere(chamaId, { ...query, memberId });
  const [rows, total] = await Promise.all([
    prisma.contributionRecord.findMany({
      where,
      include,
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.contributionRecord.count({ where }),
  ]);
  return { items: rows.map(toContributionDTO), meta: getPaginationMeta(total, query.page, query.pageSize) };
}

async function assertActiveMember(tx: Tx, chamaId: string, userId: string) {
  const m = await tx.membership.findUnique({ where: { userId_chamaId: { userId, chamaId } } });
  if (!m || m.status !== "active") throw ApiError.validation("That person is not an active member of this chama");
}

export interface RecordInput {
  memberId: string;
  amount: number;
  paidOn: string;
  method: "mpesa" | "bank" | "cash" | "other";
  mpesaReceipt?: string;
  note?: string;
  scheduleId?: string;
  goalId?: string;
}

export async function record(ctx: RequestContext, chamaId: string, input: RecordInput) {
  const paidOn = parseDateOnly(input.paidOn);
  if (paidOn.getTime() > Date.now() + 24 * 3600 * 1000) {
    throw ApiError.validation("Payment date cannot be in the future");
  }

  const row = await prisma.$transaction(async (tx) => {
    await assertActiveMember(tx, chamaId, input.memberId);
    if (input.scheduleId) {
      const s = await tx.contributionSchedule.findFirst({ where: { id: input.scheduleId, chamaId } });
      if (!s) throw ApiError.validation("Unknown contribution schedule");
    }
    if (input.goalId) {
      const g = await tx.savingsGoal.findFirst({ where: { id: input.goalId, chamaId } });
      if (!g) throw ApiError.validation("Unknown goal");
    }
    if (input.mpesaReceipt) {
      const dup = await tx.contributionRecord.findFirst({ where: { chamaId, mpesaReceipt: input.mpesaReceipt } });
      if (dup) throw ApiError.conflict(`M-Pesa receipt ${input.mpesaReceipt} is already recorded in this chama`);
    }

    const created = await tx.contributionRecord.create({
      data: {
        chamaId,
        memberId: input.memberId,
        amount: input.amount,
        paidOn,
        method: input.method,
        mpesaReceipt: input.mpesaReceipt ?? null,
        note: input.note ?? null,
        scheduleId: input.scheduleId ?? null,
        goalId: input.goalId ?? null,
        recordedById: ctx.userId,
      },
      include,
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "contribution.recorded",
      entityType: "contribution",
      entityId: created.id,
      details: {
        memberId: input.memberId,
        amount: input.amount,
        paidOn: input.paidOn,
        method: input.method,
        mpesaReceipt: input.mpesaReceipt ?? null,
      },
    });
    return created;
  });

  if (row.memberId !== ctx.userId) {
    notifications
      .create(
        row.memberId,
        "info",
        "Contribution recorded",
        `KES ${toAmount(row.amount).toLocaleString("en-KE")} paid on ${toDateOnly(row.paidOn)} was recorded. Please confirm or dispute it.`,
        `/chamas/${chamaId}/contributions`,
      )
      .catch((err: unknown) => logger.warn({ err }, "contribution notification failed"));
  }

  return toContributionDTO(row);
}

async function loadForUpdate(tx: Tx, chamaId: string, id: string) {
  const row = await tx.contributionRecord.findFirst({ where: { id, chamaId }, include });
  if (!row) throw ApiError.notFound("Contribution");
  return row;
}

/** Only the member the payment belongs to can confirm it. */
export async function confirm(ctx: RequestContext, chamaId: string, id: string) {
  const row = await prisma.$transaction(async (tx) => {
    const existing = await loadForUpdate(tx, chamaId, id);
    if (existing.memberId !== ctx.userId) {
      throw ApiError.forbidden("Only the member this payment belongs to can confirm it");
    }
    if (existing.status === "confirmed") return existing;
    if (existing.status === "voided") throw ApiError.conflict("This record has been voided");

    const updated = await tx.contributionRecord.update({
      where: { id },
      data: { status: "confirmed", confirmedAt: new Date(), disputeReason: null, disputedAt: null },
      include,
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "contribution.confirmed",
      entityType: "contribution",
      entityId: id,
      details: { previousStatus: existing.status },
    });
    return updated;
  });
  return toContributionDTO(row);
}

/** Only the member the payment belongs to can dispute it. */
export async function dispute(ctx: RequestContext, chamaId: string, id: string, reason: string) {
  const row = await prisma.$transaction(async (tx) => {
    const existing = await loadForUpdate(tx, chamaId, id);
    if (existing.memberId !== ctx.userId) {
      throw ApiError.forbidden("Only the member this payment belongs to can dispute it");
    }
    if (existing.status === "voided") throw ApiError.conflict("This record has been voided");

    const updated = await tx.contributionRecord.update({
      where: { id },
      data: { status: "disputed", disputeReason: reason, disputedAt: new Date(), confirmedAt: null },
      include,
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "contribution.disputed",
      entityType: "contribution",
      entityId: id,
      details: { previousStatus: existing.status, reason },
    });
    return updated;
  });
  return toContributionDTO(row);
}

/** Money officers void a wrong record (it stays visible, with the reason). */
export async function voidRecord(ctx: RequestContext, chamaId: string, id: string, reason: string) {
  const row = await prisma.$transaction(async (tx) => {
    const existing = await loadForUpdate(tx, chamaId, id);
    if (existing.status === "voided") throw ApiError.conflict("This record is already voided");
    const updated = await tx.contributionRecord.update({
      where: { id },
      data: { status: "voided", voidReason: reason, voidedAt: new Date(), voidedById: ctx.userId },
      include,
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "contribution.voided",
      entityType: "contribution",
      entityId: id,
      details: { previousStatus: existing.status, reason, amount: toAmount(existing.amount), memberId: existing.memberId },
    });
    return updated;
  });
  return toContributionDTO(row);
}

export async function summary(chamaId: string, viewer: { userId: string; role: string }) {
  const officer = isOfficer(viewer.role);
  const baseWhere: Prisma.ContributionRecordWhereInput = officer ? { chamaId } : { chamaId, memberId: viewer.userId };

  const [byStatus, byMember] = await Promise.all([
    prisma.contributionRecord.groupBy({ by: ["status"], where: baseWhere, _sum: { amount: true }, _count: true }),
    prisma.contributionRecord.groupBy({
      by: ["memberId"],
      where: { ...baseWhere, status: { not: "voided" } },
      _sum: { amount: true },
    }),
  ]);

  const sumFor = (status: string) => toAmount(byStatus.find((s) => s.status === status)?._sum.amount ?? 0);
  const users = await prisma.user.findMany({
    where: { id: { in: byMember.map((m) => m.memberId) } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.fullName]));

  return {
    totalConfirmed: sumFor("confirmed"),
    totalRecorded: sumFor("recorded"),
    totalDisputed: sumFor("disputed"),
    count: byStatus.filter((s) => s.status !== "voided").reduce((n, s) => n + s._count, 0),
    byMember: byMember
      .map((m) => ({ memberId: m.memberId, fullName: names.get(m.memberId) ?? "Former member", total: toAmount(m._sum.amount ?? 0) }))
      .sort((a, b) => b.total - a.total),
  };
}
