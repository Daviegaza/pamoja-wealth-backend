import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { generateReference } from "../utils/reference.js";
import { enforceRule } from "../lib/rule-enforcer.js";

export async function getWallet(userId: string) {
  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId, currency: "KES" },
    });
  }

  return {
    id: wallet.id,
    userId: wallet.userId,
    balance: Number(wallet.balance),
    currency: wallet.currency,
    pendingBalance: Number(wallet.pendingBalance),
    totalDeposits: Number(wallet.totalDeposits),
    totalWithdrawals: Number(wallet.totalWithdrawals),
    lastTransactionAt: wallet.lastTransactionAt?.toISOString() || null,
  };
}

export async function getHistory(userId: string, days: number = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      createdAt: { gte: since },
      status: "completed",
    },
    orderBy: { createdAt: "asc" },
  });

  // Build daily balance history
  const history: { date: string; balance: number }[] = [];
  let runningBalance = 0;

  for (const tx of transactions) {
    runningBalance = Number(tx.balanceAfter);
    history.push({
      date: tx.createdAt.toISOString().slice(0, 10),
      balance: runningBalance,
    });
  }

  return history;
}

export async function getTransactions(userId: string, query: {
  page: number;
  pageSize: number;
  type?: string;
  status?: string;
  chamaId?: string;
  days?: number;
}) {
  const where: any = { userId };

  if (query.type) where.type = query.type;
  if (query.status) where.status = query.status;
  if (query.chamaId) where.chamaId = query.chamaId;

  if (query.days) {
    const since = new Date();
    since.setDate(since.getDate() - query.days);
    where.createdAt = { gte: since };
  }

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    items: items.map((tx) => ({
      id: tx.id,
      userId: tx.userId,
      chamaId: tx.chamaId,
      type: tx.type,
      amount: Number(tx.amount),
      balanceAfter: Number(tx.balanceAfter),
      method: tx.method,
      reference: tx.reference,
      description: tx.description,
      status: tx.status,
      createdAt: tx.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function deposit(
  userId: string,
  amount: number,
  method: string,
  chamaId?: string
) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw ApiError.notFound("Wallet");

  if (chamaId) {
    await enforceRule("contribution_received", chamaId, { userId, amount, methodHint: method });
  }

  const reference = generateReference("DPS");
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      chamaId: chamaId || null,
      type: "contribution",
      amount,
      balanceAfter: Number(wallet.balance),
      method: method as any,
      reference,
      description: `Deposit via ${method}`,
      status: "pending",
    },
  });

  return { transaction, wallet: { id: wallet.id, balance: Number(wallet.balance) } };
}

export async function processDeposit(transactionId: string, receipt?: string) {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.status !== "pending") return null;

  const wallet = await prisma.wallet.findUnique({ where: { userId: tx.userId } });
  if (!wallet) return null;

  const newBalance = Number(wallet.balance) + Number(tx.amount);

  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "completed",
        balanceAfter: newBalance,
        ...(receipt ? { mpesaReceipt: receipt } : {}),
      },
    }),
    prisma.wallet.update({
      where: { userId: tx.userId },
      data: {
        balance: newBalance,
        totalDeposits: Number(wallet.totalDeposits) + Number(tx.amount),
        lastTransactionAt: new Date(),
      },
    }),
  ]);

  return { transactionId, newBalance };
}

export async function withdraw(
  userId: string,
  amount: number,
  method: string,
  destination: string
) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw ApiError.notFound("Wallet");

  if (Number(wallet.balance) < amount) {
    throw ApiError.insufficientFunds(Number(wallet.balance), amount);
  }

  const reference = generateReference("WTH");
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      type: "withdrawal",
      amount: -amount,
      balanceAfter: Number(wallet.balance),
      method: method as any,
      reference,
      description: `Withdrawal via ${method} to ${destination}`,
      status: "pending",
    },
  });

  return { transaction, wallet: { id: wallet.id, balance: Number(wallet.balance) } };
}

export async function processWithdrawal(transactionId: string) {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.status !== "pending") return null;

  const wallet = await prisma.wallet.findUnique({ where: { userId: tx.userId } });
  if (!wallet) return null;

  const withdrawalAmount = Math.abs(Number(tx.amount));
  const newBalance = Number(wallet.balance) - withdrawalAmount;

  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: transactionId },
      data: { status: "completed", balanceAfter: newBalance },
    }),
    prisma.wallet.update({
      where: { userId: tx.userId },
      data: {
        balance: newBalance,
        totalWithdrawals: Number(wallet.totalWithdrawals) + withdrawalAmount,
        lastTransactionAt: new Date(),
      },
    }),
  ]);

  return { transactionId, newBalance };
}

export async function processMpesaCallback(body: any) {
  const result = body.Body?.stkCallback;
  if (!result) return null;

  const checkoutRequestId = result.CheckoutRequestID;
  const tx = await prisma.transaction.findFirst({
    where: { reference: checkoutRequestId },
  });

  if (!tx || tx.status !== "pending") return null;

  if (result.ResultCode === 0) {
    return processDeposit(tx.id, result.CallbackMetadata?.Item?.find((i: any) => i.Name === "MpesaReceiptNumber")?.Value);
  } else {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "failed", description: result.ResultDesc },
    });
    return { transactionId: tx.id, status: "failed" };
  }
}

// Bank accounts
export async function addBankAccount(userId: string, data: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}) {
  const count = await prisma.bankAccount.count({ where: { userId } });
  const account = await prisma.bankAccount.create({
    data: {
      userId,
      bankName: data.bankName,
      accountNumber: data.accountNumber,
      accountName: data.accountName,
      isDefault: count === 0,
    },
  });
  return account;
}

export async function getBankAccounts(userId: string) {
  return prisma.bankAccount.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function removeBankAccount(userId: string, accountId: string) {
  const account = await prisma.bankAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw ApiError.notFound("Bank account");
  await prisma.bankAccount.delete({ where: { id: accountId } });
  return { success: true };
}

export async function setDefaultBankAccount(userId: string, accountId: string) {
  const account = await prisma.bankAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw ApiError.notFound("Bank account");
  await prisma.$transaction([
    prisma.bankAccount.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.bankAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
  ]);
  return prisma.bankAccount.findUnique({ where: { id: accountId } });
}

// M-Pesa accounts
export async function addMpesaAccount(userId: string, data: { phoneNumber: string }) {
  const count = await prisma.mpesaAccount.count({ where: { userId } });
  const account = await prisma.mpesaAccount.create({
    data: {
      userId,
      phoneNumber: data.phoneNumber,
      isDefault: count === 0,
    },
  });
  return account;
}

export async function getMpesaAccounts(userId: string) {
  return prisma.mpesaAccount.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function removeMpesaAccount(userId: string, accountId: string) {
  const account = await prisma.mpesaAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw ApiError.notFound("M-Pesa account");
  await prisma.mpesaAccount.delete({ where: { id: accountId } });
  return { success: true };
}

export async function setDefaultMpesaAccount(userId: string, accountId: string) {
  const account = await prisma.mpesaAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw ApiError.notFound("M-Pesa account");
  await prisma.$transaction([
    prisma.mpesaAccount.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.mpesaAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
  ]);
  return prisma.mpesaAccount.findUnique({ where: { id: accountId } });
}
