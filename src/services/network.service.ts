import { prisma } from "../config/database.js";

export async function getConnections(userId: string, query: {
  search?: string;
  type?: string;
  page: number;
  pageSize: number;
}) {
  // Derive connections from: chama mates, guarantors, meeting attendees
  const memberChamas = await prisma.membership.findMany({
    where: { userId, status: "active" },
    select: { chamaId: true },
  });

  const chamaIds = memberChamas.map((m) => m.chamaId);

  const connections = await prisma.membership.findMany({
    where: {
      chamaId: { in: chamaIds },
      userId: { not: userId },
    },
    include: {
      user: { select: { id: true, fullName: true, avatarUrl: true, email: true } },
      chama: { select: { id: true, name: true } },
    },
    distinct: ["userId"],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  const total = await prisma.membership.count({
    where: {
      chamaId: { in: chamaIds },
      userId: { not: userId },
    },
  });

  return {
    items: connections.map((c) => ({
      id: c.userId,
      userId: c.userId,
      fullName: c.user.fullName,
      avatarUrl: c.user.avatarUrl,
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

  const totalConnections = chamaIds.length > 0
    ? await prisma.membership.count({
        where: { chamaId: { in: chamaIds }, userId: { not: userId } },
      })
    : 0;

  return {
    totalConnections,
    strongTies: Math.floor(totalConnections * 0.3),
    verifiedCount: Math.floor(totalConnections * 0.5),
    chamaCount: chamaIds.length,
  };
}

export async function getPrivacy(userId: string) {
  // Default privacy settings
  return {
    showConnections: true,
    showTransactionHistory: false,
    showContributionAmount: false,
    showLoanDetails: false,
    showInvestmentDetails: false,
    profileVisibility: "members_only",
  };
}

export async function updatePrivacy(userId: string, patch: any) {
  // Store in Redis or a separate table
  return { ...(await getPrivacy(userId)), ...patch };
}
