import { prisma } from "../config/database.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ApiError } from "../utils/api-error.js";
import { parseDateOnly, toAmount, toAmountOrNull, toDateOnly } from "../utils/format.js";
import type { RequestContext } from "../utils/http.js";
import { isOfficer } from "../types/index.js";
import { recordAudit } from "./audit.service.js";

/**
 * Loan REGISTER. A chama sometimes lends its own money to a member; the money
 * moves from the chama's own account to the member outside Pamoja. Pamoja only
 * keeps the record: principal, the repayment the chama's own rules require,
 * and repayments the treasurer records. Pamoja does not lend, disburse,
 * calculate interest, or charge any fee.
 */

const include = {
  borrower: { select: { fullName: true } },
} as const;

type LoanRow = Prisma.LoanGetPayload<{ include: typeof include }>;

function expectedTotal(loan: { amount: { toString(): string }; agreedRepayable: { toString(): string } | null }) {
  return loan.agreedRepayable !== null ? toAmount(loan.agreedRepayable) : toAmount(loan.amount);
}

export function toLoanDTO(l: LoanRow) {
  const repaid = toAmount(l.amountRepaid);
  return {
    id: l.id,
    borrowerId: l.borrowerId,
    borrowerName: l.borrower.fullName,
    principal: toAmount(l.amount),
    agreedRepayable: toAmountOrNull(l.agreedRepayable),
    amountRepaid: repaid,
    balance: Math.max(0, Math.round((expectedTotal(l) - repaid) * 100) / 100),
    issuedOn: toDateOnly(l.issuedOn ?? l.appliedDate),
    dueDate: toDateOnly(l.dueDate),
    purpose: l.purpose,
    notes: l.notes,
    status: l.status,
    createdAt: l.createdAt.toISOString(),
  };
}

/** Only register-style loans (recorded by an officer) are shown. */
const registerOnly = { recordedById: { not: null } } as const;

export async function list(chamaId: string, viewer: { userId: string; role: string }) {
  const rows = await prisma.loan.findMany({
    where: { chamaId, ...registerOnly, ...(isOfficer(viewer.role) ? {} : { borrowerId: viewer.userId }) },
    include,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.map(toLoanDTO);
}

export async function getOne(chamaId: string, loanId: string, viewer: { userId: string; role: string }) {
  const loan = await prisma.loan.findFirst({
    where: { id: loanId, chamaId, ...registerOnly },
    include: {
      ...include,
      repaymentRecords: { include: { recordedBy: { select: { fullName: true } } }, orderBy: { paidOn: "desc" } },
    },
  });
  // Members may only see their own loans; others get 404 (not 403) so loan
  // ids are not confirmable.
  if (!loan || (!isOfficer(viewer.role) && loan.borrowerId !== viewer.userId)) {
    throw ApiError.notFound("Loan");
  }
  return {
    ...toLoanDTO(loan),
    repayments: loan.repaymentRecords.map((r) => ({
      id: r.id,
      amount: toAmount(r.amount),
      paidOn: toDateOnly(r.paidOn),
      method: r.method,
      mpesaReceipt: r.mpesaReceipt,
      note: r.note,
      recordedByName: r.recordedBy.fullName,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export interface RecordLoanInput {
  borrowerId: string;
  principal: number;
  issuedOn: string;
  dueDate: string;
  purpose: string;
  agreedRepayable?: number;
  notes?: string;
}

export async function record(ctx: RequestContext, chamaId: string, input: RecordLoanInput) {
  const loan = await prisma.$transaction(async (tx) => {
    const borrower = await tx.membership.findUnique({ where: { userId_chamaId: { userId: input.borrowerId, chamaId } } });
    if (!borrower || borrower.status !== "active") {
      throw ApiError.validation("Borrower is not an active member of this chama");
    }
    const created = await tx.loan.create({
      data: {
        chamaId,
        borrowerId: input.borrowerId,
        amount: input.principal,
        // Legacy NOT NULL columns. Pamoja does not set or compute interest.
        interestRate: 0,
        termMonths: 0,
        purpose: input.purpose,
        status: "active",
        issuedOn: parseDateOnly(input.issuedOn),
        dueDate: parseDateOnly(input.dueDate),
        agreedRepayable: input.agreedRepayable ?? null,
        notes: input.notes ?? null,
        recordedById: ctx.userId,
        approvedById: ctx.userId,
        approvedDate: new Date(),
      },
      include,
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "loan.recorded",
      entityType: "loan",
      entityId: created.id,
      details: { ...input },
    });
    return created;
  });
  return toLoanDTO(loan);
}

export interface RepaymentInput {
  amount: number;
  paidOn: string;
  method: "mpesa" | "bank" | "cash" | "other";
  mpesaReceipt?: string;
  note?: string;
}

export async function recordRepayment(ctx: RequestContext, chamaId: string, loanId: string, input: RepaymentInput) {
  await prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({ where: { id: loanId, chamaId, ...registerOnly } });
    if (!loan) throw ApiError.notFound("Loan");
    if (loan.status === "completed") throw ApiError.conflict("This loan is already fully repaid");

    if (input.mpesaReceipt) {
      const dup = await tx.loanRepaymentRecord.findFirst({ where: { chamaId, mpesaReceipt: input.mpesaReceipt } });
      if (dup) throw ApiError.conflict(`M-Pesa receipt ${input.mpesaReceipt} is already recorded in this chama`);
    }

    const total = expectedTotal(loan);
    const repaidBefore = toAmount(loan.amountRepaid);
    if (repaidBefore + input.amount > total + 0.005) {
      throw ApiError.validation(
        `Repayment exceeds the outstanding balance of KES ${(total - repaidBefore).toLocaleString("en-KE")}`,
      );
    }

    const rec = await tx.loanRepaymentRecord.create({
      data: {
        loanId,
        chamaId,
        amount: input.amount,
        paidOn: parseDateOnly(input.paidOn),
        method: input.method,
        mpesaReceipt: input.mpesaReceipt ?? null,
        note: input.note ?? null,
        recordedById: ctx.userId,
      },
    });
    const repaidAfter = Math.round((repaidBefore + input.amount) * 100) / 100;
    const completed = repaidAfter + 0.005 >= total;
    await tx.loan.update({
      where: { id: loanId },
      data: { amountRepaid: repaidAfter, ...(completed && { status: "completed" }) },
    });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "loan.repayment_recorded",
      entityType: "loan_repayment",
      entityId: rec.id,
      details: { loanId, ...input, repaidAfter, completed },
    });
  });
  return getOne(chamaId, loanId, { userId: ctx.userId, role: "chairperson" });
}

export async function setStatus(ctx: RequestContext, chamaId: string, loanId: string, status: "active" | "defaulted") {
  await prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({ where: { id: loanId, chamaId, ...registerOnly } });
    if (!loan) throw ApiError.notFound("Loan");
    if (loan.status === "completed") throw ApiError.conflict("A fully repaid loan cannot change status");
    await tx.loan.update({ where: { id: loanId }, data: { status } });
    await recordAudit(tx, ctx, {
      chamaId,
      action: "loan.status_changed",
      entityType: "loan",
      entityId: loanId,
      details: { from: loan.status, to: status },
    });
  });
  return getOne(chamaId, loanId, { userId: ctx.userId, role: "chairperson" });
}
