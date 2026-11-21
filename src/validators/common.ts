import { z } from "zod";

/** "YYYY-MM-DD", a real calendar date. */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Invalid date");

/** Positive KES amount with at most 2 decimals, capped to fit DECIMAL(14,2). */
export const amount = z
  .number({ invalid_type_error: "Amount must be a number" })
  .positive("Amount must be greater than 0")
  .max(999_999_999_999, "Amount is too large")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimal places");

export const recordMethod = z.enum(["mpesa", "bank", "cash", "other"]);

/** M-Pesa receipt codes are 10 upper-case alphanumerics (e.g. SGR7XK2LQ1). */
export const mpesaReceipt = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{8,12}$/, "M-Pesa receipt code should be 8-12 letters/digits");

export const uuid = z.string().uuid();

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportFormat = z.enum(["json", "csv", "pdf"]).default("json");
