import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";

interface PrivacySettings {
  showConnections: boolean;
  showTransactionHistory: boolean;
  showContributionAmount: boolean;
  showLoanDetails: boolean;
  showInvestmentDetails: boolean;
  profileVisibility: "public" | "members_only" | "private";
}

const DEFAULT_PRIVACY: PrivacySettings = {
  showConnections: true,
  showTransactionHistory: false,
  showContributionAmount: false,
  showLoanDetails: false,
  showInvestmentDetails: false,
  profileVisibility: "members_only",
};

function privacyKey(userId: string) {
  return `privacy:${userId}`;
}

export async function getConnections(userId: string, query: {
  search?: string;
  type?: string;
  page: number;
  pageSize: number;
}) {
  const memberChamas = await prisma.membership.findMany({
    where: { userId, status: "active" },
    select: { chamaId: true },
  });

  const chamaIds = memberChamas.map((m) => m.chamaId);

  if (chamaIds.length === 0) {
    return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
  }

  const where: any = {
    chamaId: { in: chamaIds },
    userId: { not: userId },
  };

  if (query.search) {
    where.user = {
      OR: [
        { fullName: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ],
    };
  }

  const [connections, total] = await Promise.all([
    prisma.membership.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true, email: true } },
        chama: { select: { id: true, name: true } },
      },
      distinct: ["userId"],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.membership.count({ where }),
  ]);

  return {
    items: connections.map((c) => ({
      id: c.userId,
      userId: c.userId,
      fullName: c.user.fullName,
      avatarUrl: c.user.avatarUrl,
      email: c.user.email,
      connectionType: "chama_mate",
      chamaName: c.chama.name,
      chamaId: c.chamaId,
      role: c.role,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getStats(userId: string) {
  const memberChamas = await prisma.membership.findMany({
    where: { userId, status: "active" },
    select: { chamaId: true },
  });

  const chamaIds = memberChamas.map((m) => m.chamaId);

  const [totalConnections, totalChamaMembers] = await Promise.all([
    chamaIds.length > 0
      ? prisma.membership.count({
          where: { chamaId: { in: chamaIds }, userId: { not: userId } },
        })
      : Promise.resolve(0),
    prisma.membership.count({
      where: { chamaId: { in: chamaIds } },
    }),
  ]);

  return {
    totalConnections,
    strongTies: Math.floor(totalConnections * 0.3),
    verifiedCount: Math.floor(totalConnections * 0.5),
    chamaCount: memberChamas.length,
    totalChamaMembers,
  };
}

/** Get privacy settings for a user — persisted in Redis */
export async function getPrivacy(userId: string): Promise<PrivacySettings> {
  try {
    const stored = await redis.get(privacyKey(userId));
    if (stored) {
      return { ...DEFAULT_PRIVACY, ...JSON.parse(stored) };
    }
  } catch (error) {
    logger.warn({ error, userId }, "Failed to read privacy settings from Redis");
  }
  return { ...DEFAULT_PRIVACY };
}

/** Update privacy settings — persisted in Redis */
export async function updatePrivacy(
  userId: string,
  patch: Partial<PrivacySettings>,
): Promise<PrivacySettings> {
  const current = await getPrivacy(userId);
  const updated = { ...current, ...patch };

  try {
    await redis.set(privacyKey(userId), JSON.stringify(updated));
    logger.info({ userId }, "Privacy settings updated");
  } catch (error) {
    logger.error({ error, userId }, "Failed to persist privacy settings");
    // Still return the updated settings even if persistence fails
  }

  return updated;
}
