import { z } from "zod";

export const updateSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.enum(["en", "sw"]).optional(),
  currency: z.enum(["KES", "UGX", "TZS", "RWF", "NGN", "GHS", "ZAR", "EGP"]).optional(),
  emailNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
});
