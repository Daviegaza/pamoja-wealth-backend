import { z } from "zod";

export const createInvestmentSchema = z.object({
  chamaId: z.string().uuid(),
  name: z.string().min(2).max(255),
  type: z.enum(["real_estate", "stocks", "bonds", "treasury_bills", "money_market", "sacco"]),
  amountInvested: z.number().positive(),
  riskLevel: z.enum(["low", "medium", "high"]),
  startDate: z.string(),
  maturityDate: z.string().optional(),
});

export const updateInvestmentSchema = z.object({
  currentValue: z.number().positive().optional(),
  roi: z.number().optional(),
  status: z.enum(["active", "matured", "closed", "pending"]).optional(),
});

export const investmentQuerySchema = z.object({
  chamaId: z.string().uuid().optional(),
  type: z.enum(["real_estate", "stocks", "bonds", "treasury_bills", "money_market", "sacco"]).optional(),
  status: z.enum(["active", "matured", "closed", "pending"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});
