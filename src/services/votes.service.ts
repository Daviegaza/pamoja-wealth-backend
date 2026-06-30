import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { enforceRule } from "../lib/rule-enforcer.js";

export async function create(data: {
  chamaId: string;
  title: string;
  description?: string;
  options: string[];
  closesAt: string;
}, userId: string) {
  const vote = await prisma.vote.create({
    data: {
      chamaId: data.chamaId,
      createdById: userId,
      title: data.title,
      description: data.description || null,
      closesAt: new Date(data.closesAt),
      options: {
        create: data.options.map((label) => ({ label, count: 0 })),
      },
    },
    include: { options: true },
  });

  return vote;
}

export async function castVote(voteId: string, optionId: string, userId: string) {
  const vote = await prisma.vote.findUnique({ where: { id: voteId } });
  if (!vote) throw ApiError.notFound("Vote", voteId);
  if (vote.status !== "open") throw ApiError.validation("Vote is closed");
  if (new Date() > vote.closesAt) {
    await closeExpired(voteId);
    throw ApiError.validation("Vote has expired");
  }

  // Check if already voted
  const existing = await prisma.voteBallot.findUnique({
    where: { voteId_userId: { voteId, userId } },
  });
  if (existing) throw ApiError.validation("You have already voted");

  await enforceRule("vote_cast", vote.chamaId, { voteId, userId, optionId });

  await prisma.$transaction([
    prisma.voteBallot.create({
      data: { voteId, optionId, userId },
    }),
    prisma.voteOption.update({
      where: { id: optionId },
      data: { count: { increment: 1 } },
    }),
  ]);

  return { success: true };
}

export async function getById(voteId: string, userId?: string) {
  const vote = await prisma.vote.findUnique({
    where: { id: voteId },
    include: {
      options: { orderBy: { count: "desc" } },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  if (!vote) throw ApiError.notFound("Vote", voteId);

  let userVote = null;
  if (userId) {
    const ballot = await prisma.voteBallot.findUnique({
      where: { voteId_userId: { voteId, userId } },
    });
    userVote = ballot?.optionId || null;
  }

  return {
    id: vote.id,
    chamaId: vote.chamaId,
    title: vote.title,
    description: vote.description,
    options: vote.options,
    status: vote.status,
    closesAt: vote.closesAt.toISOString(),
    createdAt: vote.createdAt.toISOString(),
    createdBy: vote.createdById,
    totalVotes: vote.options.reduce((sum, o) => sum + o.count, 0),
    userVote,
  };
}

export async function list(query: {
  chamaId?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const where: any = {};
  if (query.chamaId) where.chamaId = query.chamaId;
  if (query.status) where.status = query.status;

  const [items, total] = await Promise.all([
    prisma.vote.findMany({
      where,
      include: {
        options: true,
        _count: { select: { ballots: true } },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.vote.count({ where }),
  ]);

  return {
    items: items.map((v) => ({
      id: v.id,
      chamaId: v.chamaId,
      title: v.title,
      description: v.description,
      options: v.options,
      status: v.status,
      closesAt: v.closesAt.toISOString(),
      createdAt: v.createdAt.toISOString(),
      totalVotes: v._count.ballots,
      createdBy: v.createdById,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function close(voteId: string) {
  const vote = await prisma.vote.findUnique({
    where: { id: voteId },
    include: { options: true },
  });
  if (!vote) throw ApiError.notFound("Vote", voteId);

  const totalVotes = vote.options.reduce((sum, o) => sum + o.count, 0);
  const passed = totalVotes > 0; // Simple majority rule

  return prisma.vote.update({
    where: { id: voteId },
    data: { status: passed ? "passed" : "rejected" },
  });
}

export async function getResults(voteId: string) {
  const vote = await prisma.vote.findUnique({
    where: { id: voteId },
    include: {
      options: { orderBy: { count: "desc" } },
    },
  });
  if (!vote) throw ApiError.notFound("Vote", voteId);

  const totalVotes = vote.options.reduce((sum, o) => sum + o.count, 0);
  const winner = vote.options[0]?.label || null;

  return {
    id: vote.id,
    title: vote.title,
    status: vote.status,
    options: vote.options,
    totalVotes,
    winner,
  };
}

export async function closeExpired(voteId: string) {
  await close(voteId);
}
