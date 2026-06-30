import { z } from "zod";

export const depositSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  method: z.enum(["mpesa", "bank", "card"]),
  chamaId: z.string().uuid().optional(),
});

export const withdrawSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  method: z.enum(["mpesa", "bank"]),
  destination: z.string().min(1, "Destination is required"),
});

export const addBankAccountSchema = z.object({
  bankName: z.string().min(2).max(50),
  accountNumber: z.string().min(5).max(50),
  accountName: z.string().min(2).max(255),
});

export const addMpesaAccountSchema = z.object({
  phoneNumber: z.string().min(10).max(20),
});

export const transactionQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  type: z.enum([
    "contribution", "withdrawal", "loan_disbursement",
    "loan_repayment", "investment", "dividend", "fee", "transfer",
  ]).optional(),
  status: z.enum(["completed", "pending", "failed", "reversed"]).optional(),
  chamaId: z.string().uuid().optional(),
  days: z.coerce.number().min(1).max(365).optional(),
});

export const walletHistoryQuerySchema = z.object({
  days: z.coerce.number().min(1).max(365).default(90),
});
