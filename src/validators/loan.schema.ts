import { z } from "zod";

export const createLoanSchema = z.object({
  chamaId: z.string().uuid(),
  amount: z.number().positive(),
  termMonths: z.number().int().min(1).max(60),
  purpose: z.string().min(3).max(500),
  guarantorIds: z.array(z.string().uuid()).optional().default([]),
});

export const repayLoanSchema = z.object({
  amount: z.number().positive(),
});

export const loanQuerySchema = z.object({
  chamaId: z.string().uuid().optional(),
  status: z.enum(["pending", "approved", "active", "completed", "defaulted", "rejected"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});
