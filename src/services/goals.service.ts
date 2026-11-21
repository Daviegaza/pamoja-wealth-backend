import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { parseDateOnly, toAmount, toDateOnly } from "../utils/format.js";
import type { RequestContext } from "../utils/http.js";
import { recordAudit } from "./audit.service.js";

/**
 * Chama savings goals. Progress is DERIVED from non-voided contribution
 * records tagged with the goal — it is never typed in by hand.
 */

async function progressFor(goalIds: string[]) {
  if (goalIds.length === 0) return new Map<string, number>();
  const sums = await prisma.contributionRecord.groupBy({
    by: ["goalId"],
    where: { goalId: { in: goalIds }, status: { not: "voided" } },
    _sum: { amount: true },
  });
  return new Map(sums.map((s) => [s.goalId as string, toAmount(s._sum.amount ?? 0)]));
}

function toGoalDTO(g: { id: string; name: string; targetAmount: { toString(): string }; targetDate: Date; createdAt: Date }, current: number) {
  return {
    id: g.id,
    name: g.name,
    targetAmount: toAmount(g.targetAmount),
    currentAmount: current,
    targetDate: toDateOnly(g.targetDate),
    createdAt: g.createdAt.toISOString(),
  };
}

export async function list(chamaId: string) {
  const goals = await prisma.savingsGoal.findMany({ where: { chamaId }, orderBy: { targetDate: "asc" } });
  const progress = await progressFor(goals.map((g) => g.id));
  return goals.map((g) => toGoalDTO(g, progress.get(g.id) ?? 0));
}

export interface GoalInput {
  name: string;
  targetAmount: number;
  targetDate: string;
}

export async function create(ctx: RequestContext, chamaId: string, input: GoalInput) {
  const goal = await prisma.$transaction(async (tx) => {
    const g = await tx.savingsGoal.create({
      data: {
        chamaId,
        userId: ctx.userId,
        name: input.name,
        targetAmount: input.targetAmount,
        targetDate: parseDateOnly(input.targetDate),
      },
    });
    await recordAudit(tx, ctx, { chamaId, action: "goal.created", entityType: "goal", entityId: g.id, details: { ...input } });
    return g;
  });
  return toGoalDTO(goal, 0);
}

export async function update(ctx: RequestContext, chamaId: string, goalId: string, input: Partial<GoalInput>) {
  const goal = await prisma.$transaction(async (tx) => {
    const existing = await tx.savingsGoal.findFirst({ where: { id: goalId, chamaId } });
    if (!existing) throw ApiError.notFound("Goal");
    const g = await tx.savingsGoal.update({
      where: { id: goalId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.targetAmount !== undefined && { targetAmount: input.targetAmount }),
        ...(input.targetDate !== undefined && { targetDate: parseDateOnly(input.targetDate) }),
      },
    });
    await recordAudit(tx, ctx, { chamaId, action: "goal.updated", entityType: "goal", entityId: goalId, details: { changes: input } });
    return g;
  });
  const progress = await progressFor([goal.id]);
  return toGoalDTO(goal, progress.get(goal.id) ?? 0);
}

export async function remove(ctx: RequestContext, chamaId: string, goalId: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.savingsGoal.findFirst({ where: { id: goalId, chamaId } });
    if (!existing) throw ApiError.notFound("Goal");
    // Contribution records keep their amounts; only the goal tag is cleared
    // (FK is ON DELETE SET NULL).
    await tx.savingsGoal.delete({ where: { id: goalId } });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "goal.deleted",
      entityType: "goal",
      entityId: goalId,
      details: { name: existing.name, targetAmount: toAmount(existing.targetAmount) },
    });
  });
  return { deleted: true };
}
