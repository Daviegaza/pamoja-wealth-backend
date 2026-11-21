import { z } from "zod";
import { amount, dateOnly } from "./common.js";

export const createGoalSchema = z
  .object({ name: z.string().trim().min(2).max(120), targetAmount: amount, targetDate: dateOnly })
  .strict();

export const updateGoalSchema = createGoalSchema.partial().strict();
