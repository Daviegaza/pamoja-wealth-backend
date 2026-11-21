import crypto from "crypto";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { ErrorCode } from "../utils/error-codes.js";
import { toAmount } from "../utils/format.js";
import { generateInviteCode } from "../utils/reference.js";
import type { RequestContext } from "../utils/http.js";
import { CHAIR_ROLES, isOfficer, type Role } from "../types/index.js";
import { recordAudit, type Tx } from "./audit.service.js";
import { effectivePlan } from "./billing.service.js";

type ChamaRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  location: string | null;
  monthlyContribution: { toString(): string };
  paymentInstructions: string | null;
  status: string;
  currentPlanCode: string;
  createdAt: Date;
};

function toChamaDTO(c: ChamaRow, extra: { memberCount: number; myRole: string | null }) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    category: c.category,
    location: c.location,
    monthlyContribution: toAmount(c.monthlyContribution),
    paymentInstructions: c.paymentInstructions,
    status: c.status,
    currentPlanCode: c.currentPlanCode,
    memberCount: extra.memberCount,
    myRole: extra.myRole,
    createdAt: c.createdAt.toISOString(),
  };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "chama"}-${crypto.randomBytes(3).toString("hex")}`;
}

export async function listMine(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "active", chama: { status: { not: "archived" } } },
    include: {
      chama: { include: { _count: { select: { memberships: { where: { status: "active" } } } } } },
    },
    orderBy: { joinedAt: "desc" },
  });
  return memberships.map((m) =>
    toChamaDTO(m.chama, { memberCount: m.chama._count.memberships, myRole: m.role }),
  );
}

export async function getOne(chamaId: string, myRole: string) {
  const chama = await prisma.chama.findUnique({
    where: { id: chamaId },
    include: { _count: { select: { memberships: { where: { status: "active" } } } } },
  });
  if (!chama) throw ApiError.notFound("Chama");
  return toChamaDTO(chama, { memberCount: chama._count.memberships, myRole });
}

interface ChamaInput {
  name: string;
  description?: string;
  category: "savings" | "welfare" | "mixed";
  location?: string;
  monthlyContribution?: number;
  paymentInstructions?: string;
}

export async function create(ctx: RequestContext, input: ChamaInput) {
  const chama = await prisma.$transaction(async (tx) => {
    const created = await tx.chama.create({
      data: {
        name: input.name,
        slug: slugify(input.name),
        description: input.description ?? null,
        category: input.category,
        type: "chama",
        privacy: "private",
        allowDiscovery: false,
        location: input.location ?? null,
        monthlyContribution: input.monthlyContribution ?? 0,
        paymentInstructions: input.paymentInstructions ?? null,
      },
    });
    await tx.membership.create({ data: { userId: ctx.userId, chamaId: created.id, role: "chairperson" } });
    await recordAudit(tx, ctx, {
      chamaId: created.id,
      action: "chama.created",
      entityType: "chama",
      entityId: created.id,
      details: { name: created.name, category: created.category },
    });
    return created;
  });
  return toChamaDTO(chama, { memberCount: 1, myRole: "chairperson" });
}

export async function update(ctx: RequestContext, chamaId: string, myRole: string, input: Partial<ChamaInput>) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.chama.findUniqueOrThrow({ where: { id: chamaId } });
    const updated = await tx.chama.update({
      where: { id: chamaId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.monthlyContribution !== undefined && { monthlyContribution: input.monthlyContribution }),
        ...(input.paymentInstructions !== undefined && { paymentInstructions: input.paymentInstructions }),
      },
    });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(input) as (keyof ChamaInput)[]) {
      const from = key === "monthlyContribution" ? toAmount(before.monthlyContribution) : before[key];
      const to = key === "monthlyContribution" ? toAmount(updated.monthlyContribution) : updated[key];
      if (from !== to) changes[key] = { from, to };
    }
    await recordAudit(tx, ctx, { chamaId, action: "chama.updated", entityType: "chama", entityId: chamaId, details: { changes } });
  });
  return getOne(chamaId, myRole);
}

export async function archive(ctx: RequestContext, chamaId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.chama.update({ where: { id: chamaId }, data: { status: "archived" } });
    await recordAudit(tx, ctx, { chamaId, action: "chama.archived", entityType: "chama", entityId: chamaId });
  });
  return { archived: true };
}

export async function listMembers(chamaId: string, viewerRole: string) {
  const showContact = isOfficer(viewerRole);
  const memberships = await prisma.membership.findMany({
    where: { chamaId, status: "active" },
    include: { user: { select: { fullName: true, phone: true, avatarUrl: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    fullName: m.user.fullName,
    avatarUrl: m.user.avatarUrl,
    phone: showContact ? m.user.phone : null,
    role: (CHAIR_ROLES as readonly string[]).includes(m.role) ? "chairperson" : m.role,
    status: m.status,
    joinedAt: m.joinedAt.toISOString(),
  }));
}

async function countOtherChairs(chamaId: string, excludeUserId: string, db: Tx) {
  return db.membership.count({
    where: { chamaId, status: "active", role: { in: [...CHAIR_ROLES] }, userId: { not: excludeUserId } },
  });
}

export async function updateMemberRole(ctx: RequestContext, chamaId: string, targetUserId: string, role: Role) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({ where: { userId_chamaId: { userId: targetUserId, chamaId } } });
    if (!target || target.status !== "active") throw ApiError.notFound("Member");
    const wasChair = (CHAIR_ROLES as readonly string[]).includes(target.role);
    if (wasChair && role !== "chairperson" && (await countOtherChairs(chamaId, targetUserId, tx)) === 0) {
      throw ApiError.validation("A chama must keep at least one chairperson. Appoint another chairperson first.");
    }
    await tx.membership.update({ where: { id: target.id }, data: { role } });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "member.role_changed",
      entityType: "membership",
      entityId: target.id,
      details: { userId: targetUserId, from: target.role, to: role },
    });
  });
  return { userId: targetUserId, role };
}

export async function removeMember(ctx: RequestContext, chamaId: string, targetUserId: string) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({ where: { userId_chamaId: { userId: targetUserId, chamaId } } });
    if (!target || target.status !== "active") throw ApiError.notFound("Member");
    if ((CHAIR_ROLES as readonly string[]).includes(target.role) && (await countOtherChairs(chamaId, targetUserId, tx)) === 0) {
      throw ApiError.validation("The last chairperson cannot be removed.");
    }
    // Records are kept: the membership is deactivated, never deleted.
    await tx.membership.update({ where: { id: target.id }, data: { status: "inactive" } });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "member.removed",
      entityType: "membership",
      entityId: target.id,
      details: { userId: targetUserId },
    });
  });
  return { removed: true };
}

export async function createInviteCode(ctx: RequestContext, chamaId: string, expiresInDays: number) {
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 3600 * 1000);
  const invite = await prisma.$transaction(async (tx) => {
    const created = await tx.inviteCode.create({
      data: { chamaId, createdById: ctx.userId, code: generateInviteCode(), expiresAt },
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "invite_code.created",
      entityType: "invite_code",
      entityId: created.id,
      details: { expiresAt: expiresAt.toISOString() },
    });
    return created;
  });
  return { code: invite.code, expiresAt: invite.expiresAt?.toISOString() ?? null };
}

export async function listInviteCodes(chamaId: string) {
  const codes = await prisma.inviteCode.findMany({
    where: { chamaId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return codes.map((c) => ({ code: c.code, expiresAt: c.expiresAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() }));
}

export async function joinByCode(ctx: RequestContext, code: string) {
  const invite = await prisma.inviteCode.findUnique({
    where: { code: code.toUpperCase() },
    include: { chama: { select: { id: true, status: true } } },
  });
  if (
    !invite ||
    !invite.isActive ||
    (invite.expiresAt && invite.expiresAt <= new Date()) ||
    invite.chama.status === "archived"
  ) {
    throw ApiError.notFound("Invite code");
  }
  const chamaId = invite.chamaId;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.membership.findUnique({ where: { userId_chamaId: { userId: ctx.userId, chamaId } } });
    if (existing?.status === "active") throw ApiError.conflict("You are already a member of this chama");

    const plan = await effectivePlan(tx, chamaId);
    if (plan.memberCap !== null) {
      const active = await tx.membership.count({ where: { chamaId, status: "active" } });
      if (active >= plan.memberCap) {
        throw new ApiError(
          ErrorCode.PLAN_LIMIT_REACHED,
          `This chama has reached its ${plan.memberCap}-member limit. A chairperson or treasurer can upgrade the plan.`,
          402,
        );
      }
    }

    const membership = existing
      ? await tx.membership.update({ where: { id: existing.id }, data: { status: "active", role: "member" } })
      : await tx.membership.create({ data: { userId: ctx.userId, chamaId, role: "member" } });

    await recordAudit(tx, ctx, {
      chamaId,
      action: "member.joined",
      entityType: "membership",
      entityId: membership.id,
      details: { userId: ctx.userId, via: "invite_code", rejoined: !!existing },
    });
  });

  return getOne(chamaId, "member");
}
