import { z } from "zod";

const category = z.enum(["savings", "welfare", "mixed"]);

export const createChamaSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    category: category.default("savings"),
    location: z.string().trim().max(120).optional(),
    monthlyContribution: z.number().min(0).max(999_999_999).optional(),
    paymentInstructions: z.string().trim().max(500).optional(),
  })
  .strict();

export const updateChamaSchema = createChamaSchema.partial().strict();

export const updateMemberRoleSchema = z
  .object({ role: z.enum(["chairperson", "treasurer", "secretary", "member"]) })
  .strict();

export const createInviteCodeSchema = z
  .object({ expiresInDays: z.number().int().min(1).max(90).default(14) })
  .strict();

export const joinChamaSchema = z.object({ code: z.string().trim().min(6).max(32) }).strict();
