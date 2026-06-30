import { z } from "zod";

export const createVoteSchema = z.object({
  chamaId: z.string().uuid(),
  title: z.string().min(2).max(255),
  description: z.string().optional(),
  options: z.array(z.string().min(1).max(255)).min(2).max(10),
  closesAt: z.string(),
});

export const castVoteSchema = z.object({
  optionId: z.string().uuid(),
});

export const voteQuerySchema = z.object({
  chamaId: z.string().uuid().optional(),
  status: z.enum(["open", "closed", "passed", "rejected"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});
