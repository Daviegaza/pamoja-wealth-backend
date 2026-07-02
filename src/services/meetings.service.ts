import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import * as notifications from "./notifications.service.js";

async function notifyMembers(chamaId: string, type: string, title: string, message: string, actionUrl: string, excludeUserId?: string) {
  try {
    const members = await prisma.membership.findMany({
      where: { chamaId, status: "active", ...(excludeUserId ? { NOT: { userId: excludeUserId } } : {}) },
      select: { userId: true },
    });
    await Promise.allSettled(
      members.map((m) => notifications.create(m.userId, type, title, message, actionUrl))
    );
  } catch { /* non-blocking */ }
}

export async function create(data: {
  chamaId: string;
  title: string;
  description?: string;
  date: string;
  time: string;
  location: string;
  isVirtual: boolean;
  agenda: string[];
}, userId: string) {
  // Count members for totalInvited
  const memberCount = await prisma.membership.count({
    where: { chamaId: data.chamaId, status: "active" },
  });

  const meeting = await prisma.meeting.create({
    data: {
      chamaId: data.chamaId,
      createdById: userId,
      title: data.title,
      description: data.description || null,
      date: new Date(data.date),
      time: data.time,
      location: data.location,
      isVirtual: data.isVirtual,
      agenda: data.agenda,
      totalInvited: memberCount,
    },
  });

  await notifyMembers(
    data.chamaId,
    "meeting",
    `Meeting scheduled: ${data.title}`,
    `${data.title} on ${data.date} at ${data.time}${data.location ? ` · ${data.location}` : ""}`,
    `/meetings`,
    userId,
  );

  return meeting;
}

export async function update(meetingId: string, data: {
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  location?: string;
  status?: string;
}) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw ApiError.notFound("Meeting", meetingId);

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.date !== undefined && { date: new Date(data.date) }),
      ...(data.time !== undefined && { time: data.time }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.status !== undefined && { status: data.status as any }),
    },
  });

  const changedFields: string[] = [];
  if (data.date !== undefined) changedFields.push(`date → ${data.date}`);
  if (data.time !== undefined) changedFields.push(`time → ${data.time}`);
  if (data.location !== undefined) changedFields.push(`location → ${data.location}`);
  if (data.status !== undefined) changedFields.push(`status → ${data.status}`);
  if (changedFields.length > 0) {
    await notifyMembers(
      updated.chamaId,
      "meeting",
      `Meeting updated: ${updated.title}`,
      `Changes: ${changedFields.join(", ")}`,
      `/meetings`,
    );
  }
  return updated;
}

export async function getById(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      rsvps: {
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true } },
        },
      },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  if (!meeting) throw ApiError.notFound("Meeting", meetingId);

  const attending = meeting.rsvps.filter((r) => r.status === "attending");
  const declined = meeting.rsvps.filter((r) => r.status === "declined");

  return {
    meeting: {
      id: meeting.id,
      chamaId: meeting.chamaId,
      title: meeting.title,
      description: meeting.description,
      date: meeting.date.toISOString(),
      time: meeting.time,
      location: meeting.location,
      isVirtual: meeting.isVirtual,
      status: meeting.status,
      agenda: meeting.agenda,
      attendeesCount: meeting.attendeesCount,
      totalInvited: meeting.totalInvited,
      createdBy: meeting.createdById,
      createdAt: meeting.createdAt.toISOString(),
    },
    rsvps: meeting.rsvps.map((r) => ({
      meetingId: r.meetingId,
      userId: r.userId,
      userName: r.user.fullName,
      userAvatar: r.user.avatarUrl,
      status: r.status,
    })),
    attendees: attending.map((r) => ({
      userId: r.userId,
      fullName: r.user.fullName,
      avatarUrl: r.user.avatarUrl,
    })),
    declined: declined.map((r) => ({
      userId: r.userId,
      fullName: r.user.fullName,
      avatarUrl: r.user.avatarUrl,
    })),
  };
}

export async function list(query: {
  chamaId?: string;
  status?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}) {
  const where: any = {};
  if (query.chamaId) where.chamaId = query.chamaId;
  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    where.date = {};
    if (query.from) where.date.gte = new Date(query.from);
    if (query.to) where.date.lte = new Date(query.to);
  }

  const [items, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { date: "desc" },
    }),
    prisma.meeting.count({ where }),
  ]);

  return {
    items: items.map((m) => ({
      id: m.id,
      chamaId: m.chamaId,
      title: m.title,
      description: m.description,
      date: m.date.toISOString(),
      time: m.time,
      location: m.location,
      isVirtual: m.isVirtual,
      status: m.status,
      agenda: m.agenda,
      attendeesCount: m.attendeesCount,
      totalInvited: m.totalInvited,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function rsvp(meetingId: string, userId: string, status: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw ApiError.notFound("Meeting", meetingId);

  const rsvp = await prisma.meetingRsvp.upsert({
    where: { meetingId_userId: { meetingId, userId } },
    update: { status: status as any },
    create: { meetingId, userId, status: status as any },
  });

  // Update attendee count
  const attendingCount = await prisma.meetingRsvp.count({
    where: { meetingId, status: "attending" },
  });
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { attendeesCount: attendingCount },
  });

  return rsvp;
}

export async function saveMinutes(meetingId: string, content: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw ApiError.notFound("Meeting", meetingId);

  // Store minutes as a document
  const doc = await prisma.document.create({
    data: {
      chamaId: meeting.chamaId,
      uploadedById: userId,
      name: `Meeting Minutes - ${meeting.title}`,
      type: "doc",
      sizeKb: Math.ceil(content.length / 1024),
      storageKey: `minutes/${meetingId}.txt`,
    },
  });

  return doc;
}
