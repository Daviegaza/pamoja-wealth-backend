import { z } from "zod";

export const checkoutSchema = z
  .object({
    planCode: z.enum(["starter", "pro", "enterprise"]),
    cadence: z.enum(["monthly", "annual"]).default("monthly"),
    provider: z.enum(["flutterwave", "paystack"]),
  })
  .strict();

export const verifySchema = z.object({ reference: z.string().trim().min(6).max(100) }).strict();
