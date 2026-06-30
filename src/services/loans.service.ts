import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { generateReference } from "../utils/reference.js";
import { enforceRule } from "../lib/rule-enforcer.js";

export async function create(data: {
  chamaId: string;
  amount: number;
  termMonths: number;
  purpose: string;
  guarantorIds: string[];
}, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_chamaId: { userId, chamaId: data.chamaId } },
  });
  if (!membership) throw ApiError.forbidden("Not a member of this chama");

  await enforceRule("loan_request", data.chamaId, {
    borrowerId: userId,
    amount: data.amount,
    termMonths: data.termMonths,
    guarantorIds: data.guarantorIds,
  });

  const interestRate = 12.5; // Default rate, could be chama-specific
  const dueDate = new Date();
  dueDate.setMonth(dueDate.getMonth() + data.termMonths);

  const loan = await prisma.loan.create({
    data: {
      chamaId: data.chamaId,
      borrowerId: userId,
      amount: data.amount,
      interestRate,
      termMonths: data.termMonths,
      purpose: data.purpose,
      dueDate,
    },
  });

  if (data.guarantorIds.length > 0) {
    await prisma.loanGuarantor.createMany({
      data: data.guarantorIds.map((gId) => ({
        loanId: loan.id,
        userId: gId,
      })),
    });
  }

  // Create repayment schedule (equal monthly installments)
  const totalInterest = (data.amount * interestRate * data.termMonths) / (100 * 12);
  const totalRepayable = data.amount + totalInterest;
  const monthlyPrincipal = data.amount / data.termMonths;
  const monthlyInterest = totalInterest / data.termMonths;
  const monthlyAmount = totalRepayable / data.termMonths;

  const repayments = [];
  for (let i = 0; i < data.termMonths; i++) {
    const installmentDate = new Date();
    installmentDate.setMonth(installmentDate.getMonth() + i + 1);
    repayments.push({
      loanId: loan.id,
      amount: Math.round(monthlyAmount * 100) / 100,
      principal: Math.round(monthlyPrincipal * 100) / 100,
      interest: Math.round(monthlyInterest * 100) / 100,
      dueDate: installmentDate,
    });
  }

  await prisma.loanRepayment.createMany({ data: repayments });

  return loan;
}

export async function approve(loanId: string, userId: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw ApiError.notFound("Loan", loanId);
  if (loan.status !== "pending") throw ApiError.validation("Loan is not pending approval");

  const updated = await prisma.loan.update({
    where: { id: loanId },
    data: {
      status: "approved",
      approvedById: userId,
      approvedDate: new Date(),
    },
  });

  // Create loan_disbursement transaction
  await prisma.transaction.create({
    data: {
      userId: loan.borrowerId,
      chamaId: loan.chamaId,
      type: "loan_disbursement",
      amount: -Number(loan.amount),
      balanceAfter: 0,
      reference: generateReference("LND"),
      description: `Loan disbursement for loan ${loanId}`,
      status: "completed",
    },
  });

  return updated;
}

export async function reject(loanId: string, userId: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw ApiError.notFound("Loan", loanId);

  return prisma.loan.update({
    where: { id: loanId },
    data: {
      status: "rejected",
      approvedById: userId,
    },
  });
}

export async function getById(loanId: string) {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: {
      repayments: { orderBy: { dueDate: "asc" } },
      guarantors: { include: { user: { select: { id: true, fullName: true, avatarUrl: true } } } },
      borrower: { select: { id: true, fullName: true, avatarUrl: true } },
    },
  });
  if (!loan) throw ApiError.notFound("Loan", loanId);
  return loan;
}

export async function list(query: {
  chamaId?: string;
  status?: string;
  page: number;
  pageSize: number;
}, userId?: string) {
  const where: any = {};
  if (query.chamaId) where.chamaId = query.chamaId;
  if (query.status) where.status = query.status;

  const [items, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      include: {
        borrower: { select: { id: true, fullName: true, avatarUrl: true } },
        _count: { select: { repayments: true } },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.loan.count({ where }),
  ]);

  return {
    items: items.map((l) => ({
      id: l.id,
      chamaId: l.chamaId,
      borrowerId: l.borrowerId,
      borrowerName: l.borrower.fullName,
      borrowerAvatar: l.borrower.avatarUrl,
      amount: Number(l.amount),
      interestRate: Number(l.interestRate),
      termMonths: l.termMonths,
      amountRepaid: Number(l.amountRepaid),
      purpose: l.purpose,
      status: l.status,
      appliedDate: l.appliedDate.toISOString(),
      approvedDate: l.approvedDate?.toISOString() || null,
      dueDate: l.dueDate.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getRepayments(loanId: string) {
  return prisma.loanRepayment.findMany({
    where: { loanId },
    orderBy: { dueDate: "asc" },
  });
}

export async function repay(loanId: string, amount: number, userId: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw ApiError.notFound("Loan", loanId);
  if (loan.status !== "approved" && loan.status !== "active") {
    throw ApiError.validation("Loan is not in a repayable state");
  }

  // Mark active
  if (loan.status === "approved") {
    await prisma.loan.update({ where: { id: loanId }, data: { status: "active" } });
  }

  const newAmountRepaid = Number(loan.amountRepaid) + amount;
  const isFullyPaid = newAmountRepaid >= Number(loan.amount);

  const updated = await prisma.loan.update({
    where: { id: loanId },
    data: {
      amountRepaid: newAmountRepaid,
      status: isFullyPaid ? "completed" : "active",
    },
  });

  // Create loan_repayment transaction
  await prisma.transaction.create({
    data: {
      userId,
      chamaId: loan.chamaId,
      type: "loan_repayment",
      amount,
      balanceAfter: 0,
      reference: generateReference("LRP"),
      description: `Loan repayment for loan ${loanId}`,
      status: "completed",
    },
  });

  return updated;
}
