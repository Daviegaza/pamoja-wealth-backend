import { prisma } from "../config/database.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ApiError } from "../utils/api-error.js";
import { parseDateOnly, toDateOnly } from "../utils/format.js";
import type { RequestContext } from "../utils/http.js";
import { recordAudit } from "./audit.service.js";

type MeetingRow = Prisma.MeetingGetPayload<{ include: { rsvps: true } }>;

function agendaList(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function toMeetingDTO(m: MeetingRow, viewerId: string) {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    date: toDateOnly(m.date),
    time: m.time,
    location: m.location,
    isVirtual: m.isVirtual,
    status: m.status,
    agenda: agendaList(m.agenda),
    minutes: m.minutes,
    minutesAt: m.minutesAt?.toISOString() ?? null,
    myRsvp: m.rsvps.find((r) => r.userId === viewerId)?.status ?? null,
    attendingCount: m.rsvps.filter((r) => r.status === "attending").length,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function list(chamaId: string, viewerId: string) {
  const rows = await prisma.meeting.findMany({
    where: { chamaId },
    include: { rsvps: true },
    orderBy: { date: "desc" },
    take: 200,
  });
  return rows.map((m) => toMeetingDTO(m, viewerId));
}

export async function getOne(chamaId: string, meetingId: string, viewerId: string) {
  const m = await prisma.meeting.findFirst({ where: { id: meetingId, chamaId }, include: { rsvps: true } });
  if (!m) throw ApiError.notFound("Meeting");
  return toMeetingDTO(m, viewerId);
}

export interface MeetingInput {
  title: string;
  description?: string;
  date: string;
  time: string;
  location: string;
  isVirtual: boolean;
  agenda: string[];
}

export async function create(ctx: RequestContext, chamaId: string, input: MeetingInput) {
  const id = await prisma.$transaction(async (tx) => {
    const totalInvited = await tx.membership.count({ where: { chamaId, status: "active" } });
    const m = await tx.meeting.create({
      data: {
        chamaId,
        createdById: ctx.userId,
        title: input.title,
        description: input.description ?? null,
        date: parseDateOnly(input.date),
        time: input.time,
        location: input.location,
        isVirtual: input.isVirtual,
        agenda: input.agenda,
        totalInvited,
      },
    });
    await recordAudit(tx, ctx, { chamaId, action: "meeting.created", entityType: "meeting", entityId: m.id, details: { ...input } });
    return m.id;
  });
  return getOne(chamaId, id, ctx.userId);
}

export async function update(
  ctx: RequestContext,
  chamaId: string,
  meetingId: string,
  input: Partial<MeetingInput> & { status?: "scheduled" | "ongoing" | "completed" | "cancelled" },
) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.meeting.findFirst({ where: { id: meetingId, chamaId } });
    if (!existing) throw ApiError.notFound("Meeting");
    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.date !== undefined && { date: parseDateOnly(input.date) }),
        ...(input.time !== undefined && { time: input.time }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.isVirtual !== undefined && { isVirtual: input.isVirtual }),
        ...(input.agenda !== undefined && { agenda: input.agenda }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
    await recordAudit(tx, ctx, { chamaId, action: "meeting.updated", entityType: "meeting", entityId: meetingId, details: { changes: input } });
  });
  return getOne(chamaId, meetingId, ctx.userId);
}

export async function saveMinutes(ctx: RequestContext, chamaId: string, meetingId: string, minutes: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.meeting.findFirst({ where: { id: meetingId, chamaId } });
    if (!existing) throw ApiError.notFound("Meeting");
    await tx.meeting.update({
      where: { id: meetingId },
      data: { minutes, minutesById: ctx.userId, minutesAt: new Date() },
    });
    // The audit log keeps the previous text so edits to minutes are traceable.
    await recordAudit(tx, ctx, {
      chamaId,
      action: existing.minutes ? "meeting.minutes_edited" : "meeting.minutes_recorded",
      entityType: "meeting",
      entityId: meetingId,
      details: { previous: existing.minutes, length: minutes.length },
    });
  });
  return getOne(chamaId, meetingId, ctx.userId);
}

export async function rsvp(ctx: RequestContext, chamaId: string, meetingId: string, status: "attending" | "declined" | "tentative") {
  const m = await prisma.meeting.findFirst({ where: { id: meetingId, chamaId }, select: { id: true } });
  if (!m) throw ApiError.notFound("Meeting");
  await prisma.meetingRsvp.upsert({
    where: { meetingId_userId: { meetingId, userId: ctx.userId } },
    create: { meetingId, userId: ctx.userId, status },
    update: { status, respondedAt: new Date() },
  });
  return getOne(chamaId, meetingId, ctx.userId);
}
