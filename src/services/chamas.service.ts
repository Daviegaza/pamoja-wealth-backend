import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { generateInviteCode } from "../utils/reference.js";
import { sendInvitation } from "./email.service.js";
import * as ruleEngine from "./rule-engine.service.js";
import { logger } from "../config/logger.js";
import crypto from "crypto";

// Phased rule-engine rollout (RESEARCH_DOSSIER §7.7): when the feature
// flag is OFF, violations are logged but the operation proceeds. When ON,
// the call throws ApiError.unprocessable and the request fails 422.
async function enforceRule(
  point: ruleEngine.HookPoint,
  chamaId: string,
  ctx: ruleEngine.HookContext
): Promise<void> {
  try {
    const result = await ruleEngine.evaluate(point, chamaId, ctx);
    if (!result.allowed) {
      if (ruleEngine.isEnforcementEnabled()) {
        throw ApiError.unprocessable(result.violations);
      }
      logger.warn(
        { point, chamaId, violations: result.violations },
        "rule-engine: violations detected (shadow mode — not enforcing)"
      );
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.warn({ err, point, chamaId }, "rule-engine: evaluation error (allowing operation)");
  }
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function create(data: {
  name: string;
  description?: string;
  category: string;
  type?: string;
  privacy?: string;
  monthlyContribution: number;
  location?: string;
  tags?: string[];
  coverImageUrl?: string;
  targetAmount?: number;
  deadline?: string;
  requireKyc?: boolean;
  maxMembers?: number;
}, userId: string) {
  const slug = slugify(data.name) + "-" + crypto.randomBytes(2).toString("hex");
  const privacy = (data.privacy || "private") as any;
  const type = (data.type || "chama") as any;

  const chama = await prisma.chama.create({
    data: {
      name: data.name,
      slug,
      description: data.description || null,
      category: data.category as any,
      type,
      privacy,
      monthlyContribution: data.monthlyContribution,
      location: data.location || null,
      tags: data.tags ?? [],
      coverImageUrl: data.coverImageUrl ?? null,
      targetAmount: data.targetAmount ?? null,
      deadline: data.deadline ? new Date(data.deadline) : null,
      requireKyc: data.requireKyc ?? privacy !== "public",
      maxMembers: data.maxMembers ?? null,
      allowDiscovery: privacy === "public",
      memberships: {
        create: { userId, role: "owner" },
      },
      inviteCodes: {
        create: {
          code: generateInviteCode(),
          createdById: userId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
    },
    include: { inviteCodes: true },
  });

  return { chama, inviteCode: chama.inviteCodes[0]?.code };
}

export async function getById(chamaId: string) {
  const chama = await prisma.chama.findUnique({
    where: { id: chamaId },
    include: {
      memberships: {
        include: {
          user: {
            select: { id: true, fullName: true, avatarUrl: true, email: true, phone: true },
          },
        },
      },
    },
  });

  if (!chama) throw ApiError.notFound("Chama", chamaId);

  const stats = await getStats(chamaId);

  return {
    chama: {
      id: chama.id,
      name: chama.name,
      description: chama.description,
      category: chama.category,
      logoUrl: chama.logoUrl,
      location: chama.location,
      monthlyContribution: Number(chama.monthlyContribution),
      totalFunds: Number(chama.totalFunds),
      status: chama.status,
      nextMeetingDate: chama.nextMeetingDate?.toISOString() || null,
      createdAt: chama.createdAt.toISOString(),
      updatedAt: chama.updatedAt.toISOString(),
    },
    members: chama.memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      chamaId: m.chamaId,
      fullName: m.user.fullName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      totalContributions: Number(m.totalContributions),
      shares: m.shares,
      status: m.status,
      contributionStreak: m.contributionStreak,
      joinedAt: m.joinedAt.toISOString(),
    })),
    stats,
  };
}

export async function update(
  chamaId: string,
  data: {
    name?: string;
    description?: string;
    monthlyContribution?: number;
    location?: string;
    status?: string;
    paybillAccountNumber?: string;
  }
) {
  const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
  if (!chama) throw ApiError.notFound("Chama", chamaId);

  const updated = await prisma.chama.update({
    where: { id: chamaId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.monthlyContribution !== undefined && { monthlyContribution: data.monthlyContribution }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.status !== undefined && { status: data.status as any }),
      ...(data.paybillAccountNumber !== undefined && { paybillAccountNumber: data.paybillAccountNumber }),
    },
  });

  return updated;
}

export async function updateMemberRole(
  chamaId: string,
  targetUserId: string,
  actorUserId: string,
  newRole: "owner" | "admin" | "chairperson" | "secretary" | "treasurer" | "member",
  customTitle?: string | null,
) {
  const actor = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId: actorUserId, chamaId } },
  });
  if (!actor) throw ApiError.forbidden("Not a member of this chama");
  if (!["owner", "admin"].includes(actor.role)) {
    throw ApiError.forbidden("Only owner or admin can change roles");
  }
  const target = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId: targetUserId, chamaId } },
  });
  if (!target) throw ApiError.notFound("Member", targetUserId);
  if (target.role === "owner" && actor.role !== "owner") {
    throw ApiError.forbidden("Only owner can change owner role");
  }
  if (newRole === "owner" && actor.role !== "owner") {
    throw ApiError.forbidden("Only owner can grant owner role");
  }
  const updated = await prisma.membership.update({
    where: { userId_chamaId: { userId: targetUserId, chamaId } },
    data: {
      role: newRole,
      ...(customTitle !== undefined && { customTitle: customTitle ?? null }),
    },
  });
  return updated;
}

export async function deleteChama(chamaId: string, userId: string) {
  const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
  if (!chama) throw ApiError.notFound("Chama", chamaId);

  const membership = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId, chamaId } },
  });

  if (!membership || membership.role !== "owner") {
    throw ApiError.forbidden("Only the chama owner can delete the chama");
  }

  await prisma.chama.update({
    where: { id: chamaId },
    data: { status: "archived" },
  });

  return { success: true };
}

export async function list(query: {
  search?: string;
  category?: string;
  status?: string;
  page?: number | string;
  pageSize?: number | string;
  userId?: string;
}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
  const where: any = {};

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ];
  }
  if (query.category) where.category = query.category;
  if (query.status) where.status = query.status;
  else where.status = "active";

  // Scope to only chamas where the requesting user is an active member.
  if (query.userId) {
    where.memberships = { some: { userId: query.userId, status: "active" } };
  }

  const [items, total] = await Promise.all([
    prisma.chama.findMany({
      where,
      include: {
        _count: { select: { memberships: true } },
        ...(query.userId
          ? { memberships: { where: { userId: query.userId }, select: { role: true, customTitle: true } } }
          : {}),
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.chama.count({ where }),
  ]);

  return {
    items: items.map((c) => {
      const my = query.userId ? (c as any).memberships?.[0] : undefined;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        category: c.category,
        logoUrl: c.logoUrl,
        location: c.location,
        memberCount: c._count.memberships,
        totalFunds: Number(c.totalFunds),
        monthlyContribution: Number(c.monthlyContribution),
        status: c.status,
        nextMeetingDate: c.nextMeetingDate?.toISOString() || null,
        createdAt: c.createdAt.toISOString(),
        myRole: my?.role ?? null,
        myCustomTitle: my?.customTitle ?? null,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function getMembers(chamaId: string, query: {
  search?: string;
  role?: string;
  page: number;
  pageSize: number;
}) {
  const where: any = { chamaId };
  if (query.role) where.role = query.role;

  const [items, total] = await Promise.all([
    prisma.membership.findMany({
      where,
      include: {
        user: {
          select: { id: true, fullName: true, avatarUrl: true, email: true, phone: true },
        },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { joinedAt: "desc" },
    }),
    prisma.membership.count({ where }),
  ]);

  return {
    items: items.map((m) => ({
      id: m.id,
      userId: m.userId,
      chamaId: m.chamaId,
      fullName: m.user.fullName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      totalContributions: Number(m.totalContributions),
      shares: m.shares,
      status: m.status,
      contributionStreak: m.contributionStreak,
      joinedAt: m.joinedAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function join(chamaId: string, body: {
  inviteCode?: string;
  invitationToken?: string;
  message?: string;
}, userId: string) {
  const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
  if (!chama) throw ApiError.notFound("Chama", chamaId);

  const existing = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId, chamaId } },
  });
  if (existing) throw ApiError.conflict("Already a member of this chama");

  if (chama.maxMembers) {
    const count = await prisma.membership.count({ where: { chamaId, status: "active" } });
    if (count >= chama.maxMembers) throw ApiError.validation("Chama is at maximum capacity");
  }

  // Rule engine: eligibility + vetting + entry deposit checks.
  await enforceRule("member_apply", chamaId, { userId, sponsorIds: [] });

  // Token-based invitation
  if (body.invitationToken) {
    const inv = await prisma.invitation.findUnique({ where: { token: body.invitationToken } });
    if (!inv || inv.chamaId !== chamaId) throw ApiError.validation("Invalid invitation");
    if (inv.status !== "pending") throw ApiError.validation(`Invitation already ${inv.status}`);
    if (inv.expiresAt < new Date()) {
      await prisma.invitation.update({ where: { id: inv.id }, data: { status: "expired" } });
      throw ApiError.validation("Invitation expired");
    }
    const membership = await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: inv.id },
        data: { status: "accepted", acceptedAt: new Date(), inviteeUserId: userId },
      });
      return tx.membership.create({ data: { userId, chamaId, role: "member" } });
    });
    return { membership, status: "approved" };
  }

  // Invite-code based
  if (body.inviteCode) {
    const code = await prisma.inviteCode.findFirst({
      where: { chamaId, code: body.inviteCode, isActive: true },
    });
    if (!code) throw ApiError.validation("Invalid or expired invite code");
    if (code.expiresAt && code.expiresAt < new Date()) throw ApiError.validation("Invite code expired");
    const membership = await prisma.membership.create({
      data: { userId, chamaId, role: "member" },
    });
    return { membership, status: "approved" };
  }

  // Public chama: direct join
  if (chama.privacy === "public") {
    const membership = await prisma.membership.create({
      data: { userId, chamaId, role: "member" },
    });
    return { membership, status: "approved" };
  }

  // Private chama: file a join request
  if (chama.privacy === "private") {
    const existingReq = await prisma.joinRequest.findUnique({
      where: { chamaId_userId: { chamaId, userId } },
    });
    if (existingReq && existingReq.status === "pending") {
      return { joinRequest: existingReq, status: "pending" };
    }
    const req = await prisma.joinRequest.upsert({
      where: { chamaId_userId: { chamaId, userId } },
      update: { status: "pending", message: body.message, decidedAt: null, decidedById: null },
      create: { chamaId, userId, message: body.message ?? null },
    });
    return { joinRequest: req, status: "pending" };
  }

  throw ApiError.forbidden("This chama is invite-only — request an invitation from an admin");
}

export async function invite(
  chamaId: string,
  invitedById: string,
  body: {
    method: "phone" | "email" | "username" | "link" | "qr";
    phone?: string;
    email?: string;
    username?: string;
    message?: string;
    expiresInDays?: number;
  }
) {
  const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
  if (!chama) throw ApiError.notFound("Chama", chamaId);

  const expiresAt = new Date(Date.now() + (body.expiresInDays ?? 14) * 24 * 60 * 60 * 1000);
  const token = crypto.randomBytes(16).toString("hex");

  // Resolve username/phone/email to existing user where possible
  let inviteeUserId: string | undefined;
  if (body.username) {
    const u = await prisma.user.findUnique({ where: { username: body.username } });
    if (u) inviteeUserId = u.id;
  } else if (body.phone) {
    const u = await prisma.user.findUnique({ where: { phone: body.phone } });
    if (u) inviteeUserId = u.id;
  } else if (body.email) {
    const u = await prisma.user.findUnique({ where: { email: body.email } });
    if (u) inviteeUserId = u.id;
  }

  if (body.method === "link" || body.method === "qr") {
    // Generic invite link — also create matching invite code for short-form sharing
    const code = await prisma.inviteCode.create({
      data: { chamaId, createdById: invitedById, code: generateInviteCode(), expiresAt },
    });
    return {
      method: body.method,
      token,
      inviteCode: code.code,
      link: `/join/${chamaId}?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  const invitation = await prisma.invitation.create({
    data: {
      chamaId,
      invitedById,
      inviteeUserId,
      inviteePhone: body.phone,
      inviteeEmail: body.email,
      inviteeUsername: body.username,
      method: body.method,
      token,
      message: body.message,
      expiresAt,
    },
  });

  if (body.email) {
    try { await sendInvitation(body.email, chama.name, token); } catch { /* email service stub */ }
  }
  // TODO(sms): send SMS for phone-method invites
  // TODO(notification): push in-app notification for username-method invites resolved to a user

  return {
    invitationId: invitation.id,
    method: invitation.method,
    token,
    inviteeUserId,
    link: `/invitations/accept?token=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function discover(query: {
  search?: string;
  category?: string;
  type?: string;
  location?: string;
  tag?: string;
  page: number;
  pageSize: number;
}) {
  const where: any = {
    allowDiscovery: true,
    privacy: "public",
    status: "active",
  };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ];
  }
  if (query.category) where.category = query.category;
  if (query.type) where.type = query.type;
  if (query.location) where.location = { contains: query.location, mode: "insensitive" };
  if (query.tag) where.tags = { has: query.tag };

  const [items, total] = await Promise.all([
    prisma.chama.findMany({
      where,
      include: { _count: { select: { memberships: true, donations: true } } },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.chama.count({ where }),
  ]);

  return {
    items: items.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      category: c.category,
      type: c.type,
      privacy: c.privacy,
      logoUrl: c.logoUrl,
      coverImageUrl: c.coverImageUrl,
      location: c.location,
      tags: c.tags,
      memberCount: c._count.memberships,
      donationCount: c._count.donations,
      totalFunds: Number(c.totalFunds),
      monthlyContribution: Number(c.monthlyContribution),
      targetAmount: c.targetAmount ? Number(c.targetAmount) : null,
      raisedAmount: Number(c.raisedAmount),
      deadline: c.deadline?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function searchUserForInvite(q: string) {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { username: { contains: q, mode: "insensitive" } },
        { fullName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, fullName: true, phone: true, email: true, avatarUrl: true, location: true },
    take: 10,
  });
  return users;
}

export async function listInvitations(chamaId: string) {
  const invs = await prisma.invitation.findMany({
    where: { chamaId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return invs;
}

export async function acceptInvitation(token: string, userId: string) {
  const inv = await prisma.invitation.findUnique({ where: { token } });
  if (!inv) throw ApiError.notFound("Invitation");
  if (inv.status !== "pending") throw ApiError.validation(`Invitation already ${inv.status}`);
  if (inv.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: "expired" } });
    throw ApiError.validation("Invitation expired");
  }
  return join(inv.chamaId, { invitationToken: token }, userId);
}

export async function declineInvitation(token: string, userId: string) {
  const inv = await prisma.invitation.findUnique({ where: { token } });
  if (!inv) throw ApiError.notFound("Invitation");
  if (inv.inviteeUserId && inv.inviteeUserId !== userId) throw ApiError.forbidden();
  await prisma.invitation.update({
    where: { id: inv.id },
    data: { status: "declined" },
  });
  return { success: true };
}

export async function listMyInvitations(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];
  return prisma.invitation.findMany({
    where: {
      status: "pending",
      OR: [
        { inviteeUserId: userId },
        { inviteePhone: user.phone },
        { inviteeEmail: user.email },
        ...(user.username ? [{ inviteeUsername: user.username }] : []),
      ],
    },
    include: {
      chama: { select: { id: true, name: true, slug: true, description: true, coverImageUrl: true, category: true, type: true, privacy: true } },
      invitedBy: { select: { id: true, fullName: true, username: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listJoinRequests(chamaId: string) {
  return prisma.joinRequest.findMany({
    where: { chamaId, status: "pending" },
    include: { user: { select: { id: true, fullName: true, username: true, avatarUrl: true, phone: true, email: true, kycLevel: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function decideJoinRequest(
  chamaId: string,
  requestId: string,
  deciderId: string,
  decision: "approved" | "rejected"
) {
  const req = await prisma.joinRequest.findUnique({ where: { id: requestId } });
  if (!req || req.chamaId !== chamaId) throw ApiError.notFound("Join request");
  if (req.status !== "pending") throw ApiError.validation(`Already ${req.status}`);

  return prisma.$transaction(async (tx) => {
    await tx.joinRequest.update({
      where: { id: requestId },
      data: { status: decision, decidedById: deciderId, decidedAt: new Date() },
    });
    if (decision === "approved") {
      return tx.membership.create({
        data: { userId: req.userId, chamaId, role: "member" },
      });
    }
    return null;
  });
}

export async function donate(chamaId: string, data: {
  amount: number;
  message?: string;
  isAnonymous?: boolean;
  donorName?: string;
  donorEmail?: string;
  donorPhone?: string;
  paymentMethod?: "mpesa" | "bank" | "card" | "cash";
}, userId?: string) {
  const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
  if (!chama) throw ApiError.notFound("Chama", chamaId);
  if (chama.type !== "fundraiser") throw ApiError.validation("Donations only on fundraiser-type chamas");

  // Rule engine: only evaluate when the donor is a known user (anonymous /
  // public donors bypass — they are not bound by the chama's contribution
  // rules). For known users we treat the donation as a contribution event.
  if (userId) {
    await enforceRule("contribution_received", chamaId, {
      userId,
      amount: data.amount,
      methodHint: data.paymentMethod,
    });
  }

  const ref = "PW" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const result = await prisma.$transaction(async (tx) => {
    const d = await tx.donation.create({
      data: {
        chamaId,
        userId: userId ?? null,
        donorName: data.donorName ?? null,
        donorEmail: data.donorEmail ?? null,
        donorPhone: data.donorPhone ?? null,
        amount: data.amount,
        message: data.message ?? null,
        isAnonymous: data.isAnonymous ?? false,
        paymentMethod: (data.paymentMethod ?? "mpesa") as any,
        reference: ref,
      },
    });
    await tx.chama.update({
      where: { id: chamaId },
      data: { raisedAmount: { increment: data.amount } },
    });
    return d;
  });
  return result;
}

export async function listDonations(chamaId: string, page = 1, pageSize = 20) {
  const [items, total] = await Promise.all([
    prisma.donation.findMany({
      where: { chamaId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { id: true, fullName: true, username: true, avatarUrl: true } } },
    }),
    prisma.donation.count({ where: { chamaId } }),
  ]);
  return {
    items: items.map((d) => ({
      id: d.id,
      donorName: d.isAnonymous ? "Anonymous" : (d.user?.fullName || d.donorName || "Donor"),
      donorAvatar: d.isAnonymous ? null : d.user?.avatarUrl,
      amount: Number(d.amount),
      message: d.message,
      isAnonymous: d.isAnonymous,
      paymentMethod: d.paymentMethod,
      createdAt: d.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

export async function approveJoin(
  chamaId: string,
  targetUserId: string,
  _approverId: string
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId: targetUserId, chamaId } },
  });
  if (!membership) throw ApiError.notFound("Membership");

  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: { status: "active" },
  });

  return updated;
}

export async function removeMember(chamaId: string, targetUserId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId: targetUserId, chamaId } },
  });
  if (!membership) throw ApiError.notFound("Membership");
  if (membership.role === "owner") {
    throw ApiError.validation("Cannot remove the chama owner");
  }

  await prisma.membership.delete({ where: { id: membership.id } });
  return { success: true };
}

export async function getStats(chamaId: string) {
  const [memberCount, pendingLoans, activeInvestments, totalFunds] = await Promise.all([
    prisma.membership.count({ where: { chamaId, status: "active" } }),
    prisma.loan.count({ where: { chamaId, status: "pending" } }),
    prisma.investment.count({ where: { chamaId, status: "active" } }),
    prisma.chama.findUnique({ where: { id: chamaId }, select: { totalFunds: true, monthlyContribution: true } }),
  ]);

  return {
    totalFunds: Number(totalFunds?.totalFunds || 0),
    memberCount,
    growthRate: 0, // computed by analytics job
    monthlyContribution: Number(totalFunds?.monthlyContribution || 0),
    pendingLoans,
    activeInvestments,
  };
}

export async function getAnalytics(
  chamaId: string,
  period: string,
  from?: string,
  to?: string
) {
  const cache = await prisma.analyticsCache.findMany({
    where: { chamaId, period, periodKey: from || to || getCurrentPeriodKey(period) },
  });

  return {
    chamaId,
    period,
    cache: cache.map((c) => ({
      metric: c.metric,
      value: Number(c.value),
      periodKey: c.periodKey,
    })),
  };
}

function getCurrentPeriodKey(period: string): string {
  const now = new Date();
  switch (period) {
    case "daily":
      return now.toISOString().slice(0, 10);
    case "monthly":
      return now.toISOString().slice(0, 7);
    case "yearly":
      return now.getFullYear().toString();
    default:
      return now.toISOString().slice(0, 7);
  }
}
