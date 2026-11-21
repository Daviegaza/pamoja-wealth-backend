import { z } from "zod";
import { amount, dateOnly, mpesaReceipt, recordMethod, uuid } from "./common.js";

export const recordLoanSchema = z
  .object({
    borrowerId: uuid,
    principal: amount,
    issuedOn: dateOnly,
    dueDate: dateOnly,
    purpose: z.string().trim().min(2).max(500),
    // What the chama's OWN rules say the borrower must repay. Pamoja never
    // computes or charges interest; this is a record of the chama's terms.
    agreedRepayable: amount.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.dueDate >= v.issuedOn, { message: "dueDate must be on or after issuedOn", path: ["dueDate"] })
  .refine((v) => v.agreedRepayable === undefined || v.agreedRepayable >= v.principal, {
    message: "agreedRepayable cannot be less than principal",
    path: ["agreedRepayable"],
  });

export const recordRepaymentSchema = z
  .object({
    amount,
    paidOn: dateOnly,
    method: recordMethod,
    mpesaReceipt: mpesaReceipt.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const loanStatusSchema = z.object({ status: z.enum(["active", "defaulted"]) }).strict();
