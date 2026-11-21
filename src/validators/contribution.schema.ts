import { z } from "zod";
import { amount, dateOnly, mpesaReceipt, recordMethod, uuid } from "./common.js";

export const createScheduleSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    amount,
    frequency: z.enum(["weekly", "monthly", "one_off"]),
    startDate: dateOnly,
    dueDay: z.number().int().min(1).max(31).optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateScheduleSchema = createScheduleSchema.partial().strict();

export const recordContributionSchema = z
  .object({
    memberId: uuid,
    amount,
    paidOn: dateOnly,
    method: recordMethod,
    mpesaReceipt: mpesaReceipt.optional(),
    note: z.string().trim().max(500).optional(),
    scheduleId: uuid.optional(),
    goalId: uuid.optional(),
  })
  .strict();

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const listContributionsQuery = z.object({
  memberId: uuid.optional(),
  status: z.enum(["recorded", "confirmed", "disputed", "voided"]).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
