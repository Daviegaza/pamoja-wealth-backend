import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";

export async function create(data: {
  name: string;
  targetAmount: number;
  targetDate: string;
  chamaId?: string;
}, userId: string) {
  return prisma.savingsGoal.create({
    data: {
      userId,
      chamaId: data.chamaId || null,
      name: data.name,
      targetAmount: data.targetAmount,
      targetDate: new Date(data.targetDate),
    },
  });
}

export async function update(goalId: string, data: {
  name?: string;
  targetAmount?: number;
  targetDate?: string;
}, userId: string) {
  const goal = await prisma.savingsGoal.findFirst({
    where: { id: goalId, userId },
  });
  if (!goal) throw ApiError.notFound("Goal", goalId);

  return prisma.savingsGoal.update({
    where: { id: goalId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.targetAmount !== undefined && { targetAmount: data.targetAmount }),
      ...(data.targetDate !== undefined && { targetDate: new Date(data.targetDate) }),
    },
  });
}

export async function list(userId: string) {
  return prisma.savingsGoal.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function remove(goalId: string, userId: string) {
  const goal = await prisma.savingsGoal.findFirst({
    where: { id: goalId, userId },
  });
  if (!goal) throw ApiError.notFound("Goal", goalId);
  await prisma.savingsGoal.delete({ where: { id: goalId } });
  return { success: true };
}
