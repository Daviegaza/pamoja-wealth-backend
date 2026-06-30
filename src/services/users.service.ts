import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { getPaginationParams } from "../utils/pagination.js";

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallet: true,
      memberships: {
        include: { chama: { select: { id: true, name: true, category: true, logoUrl: true } } },
      },
    },
  });

  if (!user) throw ApiError.notFound("User");

  const totalContributed = user.memberships.reduce(
    (sum, m) => sum + Number(m.totalContributions),
    0
  );

  const totalBorrowed = await prisma.loan.aggregate({
    where: { borrowerId: userId, status: { in: ["active", "completed"] } },
    _sum: { amount: true },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      location: user.location,
      isVerified: user.isVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
      createdAt: user.createdAt.toISOString(),
    },
    wallet: user.wallet ? {
      id: user.wallet.id,
      balance: Number(user.wallet.balance),
      currency: user.wallet.currency,
      pendingBalance: Number(user.wallet.pendingBalance),
      totalDeposits: Number(user.wallet.totalDeposits),
      totalWithdrawals: Number(user.wallet.totalWithdrawals),
    } : null,
    memberships: user.memberships.map((m) => ({
      id: m.id,
      chamaId: m.chamaId,
      chamaName: m.chama.name,
      chamaCategory: m.chama.category,
      chamaLogo: m.chama.logoUrl,
      role: m.role,
      totalContributions: Number(m.totalContributions),
      shares: m.shares,
      contributionStreak: m.contributionStreak,
      status: m.status,
      joinedAt: m.joinedAt.toISOString(),
    })),
    totalContributed,
    totalBorrowed: Number(totalBorrowed._sum.amount || 0),
  };
}

export async function updateProfile(
  userId: string,
  data: {
    fullName?: string;
    phone?: string;
    location?: string;
    avatarUrl?: string;
  }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("User");

  if (data.phone && data.phone !== user.phone) {
    const existing = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (existing) throw ApiError.conflict("Phone number already in use");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
    },
  });

  return {
    id: updated.id,
    email: updated.email,
    phone: updated.phone,
    fullName: updated.fullName,
    avatarUrl: updated.avatarUrl,
    location: updated.location,
    isVerified: updated.isVerified,
  };
}

export async function getPublicProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      location: true,
      createdAt: true,
    },
  });

  if (!user) throw ApiError.notFound("User");
  return user;
}

export async function searchUsers(query: string, chamaId?: string) {
  const where: any = {
    OR: [
      { fullName: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { phone: { contains: query, mode: "insensitive" } },
    ],
  };

  if (chamaId) {
    where.memberships = { some: { chamaId } };
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      location: true,
      email: true,
    },
    take: 20,
  });

  return users;
}
