import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { status: "active", chama: { status: { not: "archived" } } },
        include: { chama: { select: { id: true, name: true, category: true } } },
      },
    },
  });

  if (!user) throw ApiError.notFound("User");

  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      location: user.location,
      bio: user.bio,
      isVerified: user.isVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    memberships: user.memberships.map((m) => ({
      chamaId: m.chamaId,
      chamaName: m.chama.name,
      chamaCategory: m.chama.category,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
  };
}

export async function updateProfile(
  userId: string,
  data: { fullName?: string; location?: string; avatarUrl?: string; bio?: string },
) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      ...(data.bio !== undefined && { bio: data.bio }),
    },
  });

  return {
    id: updated.id,
    email: updated.email,
    phone: updated.phone,
    fullName: updated.fullName,
    avatarUrl: updated.avatarUrl,
    location: updated.location,
    bio: updated.bio,
    isVerified: updated.isVerified,
  };
}
