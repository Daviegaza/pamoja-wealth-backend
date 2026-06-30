import { z } from "zod";

export const createGoalSchema = z.object({
  name: z.string().min(2).max(255),
  targetAmount: z.number().positive(),
  targetDate: z.string(),
  chamaId: z.string().uuid().optional(),
});

export const updateGoalSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  targetAmount: z.number().positive().optional(),
  targetDate: z.string().optional(),
});
