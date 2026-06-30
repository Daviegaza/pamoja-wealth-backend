import { createHash } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";

/**
 * Double-entry ledger service.
 *
 * - Every monetary movement is a *transfer* — one or more `LedgerEntry` rows
 *   sharing a `transferId`. Within a transfer, `sum(debit) === sum(credit)`.
 * - `LedgerEntry.idempotencyKey` is a UNIQUE column. The service derives a
 *   per-leg key from the caller's logical `idempotencyKey` so retries replay
 *   instead of duplicating.
 * - Account-type normality drives whether `balance()` returns
 *   `sum(debit) - sum(credit)` (debit-normal: assets) or the reverse
 *   (credit-normal: liabilities + revenue).
 *
 * Reference: RESEARCH_DOSSIER.md §7.1 (double-entry ledger).
 */

// ── Types ────────────────────────────────────────────────────────────

// The Prisma client types for LedgerAccount/LedgerEntry are generated when
// `prisma generate` runs against the schema that ships these models. We use
// structural types here to keep the module compiling regardless of generation
// state.
export interface LedgerAccount {
  id: string;
  type: LedgerAccountType;
  ownerUserId: string | null;
  ownerChamaId: string | null;
  currency: string;
  debitNormal: boolean;
  createdAt: Date;
}

export interface LedgerEntry {
  id: string;
  transferId: string;
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  currency: string;
  idempotencyKey: string;
  mpesaReceipt: string | null;
  providerRef: string | null;
  metadata: unknown;
  createdAt: Date;
}

export type LedgerAccountType =
  | "member_wallet"
  | "chama_pool_wallet"
  | "fundraiser_escrow"
  | "loan_principal_receivable"
  | "loan_interest_receivable"
  | "platform_fee_revenue"
  | "mpesa_clearing"
  | "suspense";

export interface Posting {
  accountId: string;
  debit?: Decimal | string | number;
  credit?: Decimal | string | number;
}

export interface PostTransferInput {
  postings: Posting[];
  idempotencyKey: string;
  mpesaReceipt?: string;
  providerRef?: string;
  metadata?: Record<string, unknown>;
}

// ── Errors ───────────────────────────────────────────────────────────

export class LedgerImbalanceError extends Error {
  constructor(public readonly debitTotal: Decimal, public readonly creditTotal: Decimal) {
    super(
      `Ledger imbalance: sum(debit)=${debitTotal.toString()} !== sum(credit)=${creditTotal.toString()}`,
    );
    this.name = "LedgerImbalanceError";
  }
}

export class LedgerIdempotencyConflictError extends Error {
  constructor(public readonly idempotencyKey: string, message?: string) {
    super(message ?? `Ledger idempotency conflict on key=${idempotencyKey}`);
    this.name = "LedgerIdempotencyConflictError";
  }
}

// ── Account-type rules ───────────────────────────────────────────────

const DEBIT_NORMAL_BY_TYPE: Record<LedgerAccountType, boolean> = {
  member_wallet: false, // liability to member — credit-normal
  chama_pool_wallet: false, // liability to group — credit-normal
  fundraiser_escrow: false, // liability to beneficiary — credit-normal
  loan_principal_receivable: true, // asset — debit-normal
  loan_interest_receivable: true, // asset — debit-normal
  platform_fee_revenue: false, // revenue — credit-normal
  mpesa_clearing: true, // asset (money with Safaricom in transit) — debit-normal
  suspense: true, // catch-all — treat as asset until reclassified
};

// ── Decimal helpers ──────────────────────────────────────────────────

const ZERO = new Decimal(0);

function toDecimal(value: Decimal | string | number | undefined | null): Decimal {
  if (value === undefined || value === null) return ZERO;
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ── Account getters ──────────────────────────────────────────────────

async function findOrCreateAccount(args: {
  type: LedgerAccountType;
  ownerUserId?: string | null;
  ownerChamaId?: string | null;
  currency: string;
}): Promise<LedgerAccount> {
  const { type, currency } = args;
  const ownerUserId = args.ownerUserId ?? null;
  const ownerChamaId = args.ownerChamaId ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const existing = await db.ledgerAccount.findUnique({
    where: {
      type_ownerUserId_ownerChamaId: { type, ownerUserId, ownerChamaId },
    },
  });
  if (existing) return existing as LedgerAccount;

  try {
    const created = await db.ledgerAccount.create({
      data: {
        type,
        ownerUserId,
        ownerChamaId,
        currency,
        debitNormal: DEBIT_NORMAL_BY_TYPE[type],
      },
    });
    return created as LedgerAccount;
  } catch (err) {
    // Race on the @@unique([type, ownerUserId, ownerChamaId]) — re-read.
    const after = await db.ledgerAccount.findUnique({
      where: {
        type_ownerUserId_ownerChamaId: { type, ownerUserId, ownerChamaId },
      },
    });
    if (after) return after as LedgerAccount;
    throw err;
  }
}

export async function getOrCreateMemberWallet(
  userId: string,
  currency: string = "KES",
): Promise<LedgerAccount> {
  return findOrCreateAccount({ type: "member_wallet", ownerUserId: userId, currency });
}

export async function getOrCreateChamaPoolWallet(
  chamaId: string,
  currency: string = "KES",
): Promise<LedgerAccount> {
  return findOrCreateAccount({ type: "chama_pool_wallet", ownerChamaId: chamaId, currency });
}

export async function getOrCreateFundraiserEscrow(
  chamaId: string,
  currency: string = "KES",
): Promise<LedgerAccount> {
  return findOrCreateAccount({ type: "fundraiser_escrow", ownerChamaId: chamaId, currency });
}

export async function getOrCreateSystemAccount(
  type: "platform_fee_revenue" | "mpesa_clearing" | "suspense",
  currency: string = "KES",
): Promise<LedgerAccount> {
  return findOrCreateAccount({ type, currency });
}

async function getOrCreateLoanReceivable(
  type: "loan_principal_receivable" | "loan_interest_receivable",
  chamaId: string,
  borrowerUserId: string,
  currency: string = "KES",
): Promise<LedgerAccount> {
  return findOrCreateAccount({
    type,
    ownerChamaId: chamaId,
    ownerUserId: borrowerUserId,
    currency,
  });
}

// ── Balance queries ──────────────────────────────────────────────────

export async function balance(accountId: string): Promise<Decimal> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const account = (await db.ledgerAccount.findUnique({ where: { id: accountId } })) as
    | LedgerAccount
    | null;
  if (!account) return ZERO;

  const agg = await db.ledgerEntry.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });

  const debitTotal = toDecimal(agg._sum?.debit);
  const creditTotal = toDecimal(agg._sum?.credit);

  return account.debitNormal ? debitTotal.minus(creditTotal) : creditTotal.minus(debitTotal);
}

export async function balanceForUser(userId: string): Promise<Decimal> {
  const account = await getOrCreateMemberWallet(userId);
  return balance(account.id);
}

export async function balanceForChama(chamaId: string): Promise<Decimal> {
  const account = await getOrCreateChamaPoolWallet(chamaId);
  return balance(account.id);
}

// ── Core primitive: postTransfer ─────────────────────────────────────

function validateBalanced(postings: Posting[]): { debitTotal: Decimal; creditTotal: Decimal } {
  let debitTotal = ZERO;
  let creditTotal = ZERO;
  for (const p of postings) {
    debitTotal = debitTotal.plus(toDecimal(p.debit));
    creditTotal = creditTotal.plus(toDecimal(p.credit));
  }
  if (!debitTotal.equals(creditTotal)) {
    throw new LedgerImbalanceError(debitTotal, creditTotal);
  }
  return { debitTotal, creditTotal };
}

function entryKeyFor(idempotencyKey: string, index: number): string {
  return sha256Hex(`${idempotencyKey}:${index}`);
}

/**
 * Post a balanced multi-leg transfer atomically.
 *
 * Idempotency: caller supplies one logical `idempotencyKey`. The service
 * derives per-leg keys (`sha256(${idempotencyKey}:${index})`). If the first
 * leg's key already exists in `ledger_entries`, the transfer has already been
 * posted — we return the existing `transferId` and the existing legs.
 */
export async function postTransfer(
  input: PostTransferInput,
): Promise<{ transferId: string; entries: LedgerEntry[] }> {
  if (!input.postings || input.postings.length < 2) {
    throw new Error("postTransfer requires at least 2 postings");
  }
  validateBalanced(input.postings);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  // Idempotency replay check (cheap pre-check — the unique constraint is the
  // real guarantee below).
  const firstKey = entryKeyFor(input.idempotencyKey, 0);
  const existingFirst = (await db.ledgerEntry.findUnique({
    where: { idempotencyKey: firstKey },
  })) as LedgerEntry | null;
  if (existingFirst) {
    const existingEntries = (await db.ledgerEntry.findMany({
      where: { transferId: existingFirst.transferId },
      orderBy: { createdAt: "asc" },
    })) as LedgerEntry[];
    logger.info(
      { idempotencyKey: input.idempotencyKey, transferId: existingFirst.transferId },
      "ledger.postTransfer: idempotent replay, returning existing transfer",
    );
    return { transferId: existingFirst.transferId, entries: existingEntries };
  }

  // Generate transferId outside the transaction so all legs share it.
  const transferId = `tx_${sha256Hex(input.idempotencyKey).slice(0, 24)}`;

  try {
    const entries = await prisma.$transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txDb = tx as any;
      const created: LedgerEntry[] = [];
      for (let i = 0; i < input.postings.length; i++) {
        const p = input.postings[i];
        const debit = toDecimal(p.debit);
        const credit = toDecimal(p.credit);
        if (debit.lt(0) || credit.lt(0)) {
          throw new Error(`Negative amount in posting[${i}]`);
        }
        if (debit.gt(0) && credit.gt(0)) {
          throw new Error(`Posting[${i}] must have exactly one of debit/credit, not both`);
        }
        const account = (await txDb.ledgerAccount.findUnique({
          where: { id: p.accountId },
        })) as LedgerAccount | null;
        if (!account) throw new Error(`Posting[${i}] references unknown accountId=${p.accountId}`);

        const row = (await txDb.ledgerEntry.create({
          data: {
            transferId,
            accountId: p.accountId,
            debit,
            credit,
            currency: account.currency,
            idempotencyKey: entryKeyFor(input.idempotencyKey, i),
            mpesaReceipt: input.mpesaReceipt ?? null,
            providerRef: input.providerRef ?? null,
            metadata: input.metadata ?? undefined,
          },
        })) as LedgerEntry;
        created.push(row);
      }
      return created;
    });

    logger.info(
      { transferId, legs: entries.length, idempotencyKey: input.idempotencyKey },
      "ledger.postTransfer: posted",
    );
    return { transferId, entries };
  } catch (err) {
    // If the unique constraint fired on the first leg due to a race with a
    // sibling worker, fall back to the replay path.
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2002") {
      const sibling = (await db.ledgerEntry.findUnique({
        where: { idempotencyKey: firstKey },
      })) as LedgerEntry | null;
      if (sibling) {
        const existingEntries = (await db.ledgerEntry.findMany({
          where: { transferId: sibling.transferId },
          orderBy: { createdAt: "asc" },
        })) as LedgerEntry[];
        return { transferId: sibling.transferId, entries: existingEntries };
      }
      throw new LedgerIdempotencyConflictError(input.idempotencyKey);
    }
    throw err;
  }
}

// ── Convenience wrappers ─────────────────────────────────────────────

/**
 * Contribution: M-Pesa → member sub-ledger → chama pool. 4 entries:
 *   DR mpesa_clearing      / CR member_wallet     (money lands with us, we owe member)
 *   DR member_wallet       / CR chama_pool_wallet (member contributes share to group)
 *
 * If `memberUserId` isn't supplied, we look up the member by MSISDN via
 * MpesaAccount.
 */
export async function recordContribution(input: {
  chamaId: string;
  fromMsisdn: string;
  memberUserId?: string;
  amountKes: Decimal | string | number;
  mpesaReceipt: string;
  idempotencyKey: string;
}): Promise<{ transferId: string }> {
  const amount = toDecimal(input.amountKes);
  if (amount.lte(0)) throw new Error("Contribution amount must be positive");

  let memberUserId = input.memberUserId;
  if (!memberUserId) {
    const mpesaAccount = await prisma.mpesaAccount.findFirst({
      where: { phoneNumber: input.fromMsisdn },
      select: { userId: true },
    });
    if (!mpesaAccount) {
      throw new Error(
        `recordContribution: cannot resolve member for MSISDN=${input.fromMsisdn} (no MpesaAccount link)`,
      );
    }
    memberUserId = mpesaAccount.userId;
  }

  const [mpesaClearing, memberWallet, chamaPool] = await Promise.all([
    getOrCreateSystemAccount("mpesa_clearing"),
    getOrCreateMemberWallet(memberUserId),
    getOrCreateChamaPoolWallet(input.chamaId),
  ]);

  const { transferId } = await postTransfer({
    idempotencyKey: input.idempotencyKey,
    mpesaReceipt: input.mpesaReceipt,
    metadata: {
      kind: "contribution",
      chamaId: input.chamaId,
      memberUserId,
      fromMsisdn: input.fromMsisdn,
    },
    postings: [
      { accountId: mpesaClearing.id, debit: amount },
      { accountId: memberWallet.id, credit: amount },
      { accountId: memberWallet.id, debit: amount },
      { accountId: chamaPool.id, credit: amount },
    ],
  });

  return { transferId };
}

/**
 * Harambee donation: M-Pesa → fundraiser escrow (net) + platform fee. 3 entries:
 *   DR mpesa_clearing(gross) / CR fundraiser_escrow(net) / CR platform_fee_revenue(fee)
 */
export async function recordHarambeeDonation(input: {
  chamaId: string;
  donorMsisdn?: string;
  donorUserId?: string;
  amountKes: Decimal | string | number;
  platformFeeKes: Decimal | string | number;
  mpesaReceipt: string;
  idempotencyKey: string;
}): Promise<{ transferId: string; netToEscrow: Decimal }> {
  const gross = toDecimal(input.amountKes);
  const fee = toDecimal(input.platformFeeKes);
  if (gross.lte(0)) throw new Error("Donation amount must be positive");
  if (fee.lt(0)) throw new Error("Platform fee cannot be negative");
  if (fee.gt(gross)) throw new Error("Platform fee cannot exceed gross amount");
  const net = gross.minus(fee);

  const [mpesaClearing, escrow, feeRevenue] = await Promise.all([
    getOrCreateSystemAccount("mpesa_clearing"),
    getOrCreateFundraiserEscrow(input.chamaId),
    getOrCreateSystemAccount("platform_fee_revenue"),
  ]);

  const { transferId } = await postTransfer({
    idempotencyKey: input.idempotencyKey,
    mpesaReceipt: input.mpesaReceipt,
    metadata: {
      kind: "harambee_donation",
      chamaId: input.chamaId,
      donorMsisdn: input.donorMsisdn,
      donorUserId: input.donorUserId,
      gross: gross.toString(),
      fee: fee.toString(),
    },
    postings: [
      { accountId: mpesaClearing.id, debit: gross },
      { accountId: escrow.id, credit: net },
      { accountId: feeRevenue.id, credit: fee },
    ],
  });

  return { transferId, netToEscrow: net };
}

/**
 * Payout: chama → member → M-Pesa. 4 entries:
 *   DR chama_pool_wallet / CR member_wallet
 *   DR member_wallet     / CR mpesa_clearing
 */
export async function recordPayout(input: {
  chamaId: string;
  recipientUserId: string;
  amountKes: Decimal | string | number;
  mpesaConversationId?: string;
  idempotencyKey: string;
}): Promise<{ transferId: string }> {
  const amount = toDecimal(input.amountKes);
  if (amount.lte(0)) throw new Error("Payout amount must be positive");

  const [chamaPool, memberWallet, mpesaClearing] = await Promise.all([
    getOrCreateChamaPoolWallet(input.chamaId),
    getOrCreateMemberWallet(input.recipientUserId),
    getOrCreateSystemAccount("mpesa_clearing"),
  ]);

  const { transferId } = await postTransfer({
    idempotencyKey: input.idempotencyKey,
    providerRef: input.mpesaConversationId,
    metadata: {
      kind: "payout",
      chamaId: input.chamaId,
      recipientUserId: input.recipientUserId,
      mpesaConversationId: input.mpesaConversationId,
    },
    postings: [
      { accountId: chamaPool.id, debit: amount },
      { accountId: memberWallet.id, credit: amount },
      { accountId: memberWallet.id, debit: amount },
      { accountId: mpesaClearing.id, credit: amount },
    ],
  });

  return { transferId };
}

/**
 * Loan disbursement: chama pool funds the borrower's wallet; we record a
 * receivable from the borrower back to the chama pool.
 *   DR chama_pool_wallet           / CR member_wallet            (borrower receives funds)
 *   DR loan_principal_receivable   / CR chama_pool_wallet        (chama is owed back)
 */
export async function recordLoanDisbursement(input: {
  chamaId: string;
  borrowerUserId: string;
  amountKes: Decimal | string | number;
  idempotencyKey: string;
}): Promise<{ transferId: string }> {
  const amount = toDecimal(input.amountKes);
  if (amount.lte(0)) throw new Error("Loan amount must be positive");

  const [chamaPool, memberWallet, principalReceivable] = await Promise.all([
    getOrCreateChamaPoolWallet(input.chamaId),
    getOrCreateMemberWallet(input.borrowerUserId),
    getOrCreateLoanReceivable("loan_principal_receivable", input.chamaId, input.borrowerUserId),
  ]);

  const { transferId } = await postTransfer({
    idempotencyKey: input.idempotencyKey,
    metadata: {
      kind: "loan_disbursement",
      chamaId: input.chamaId,
      borrowerUserId: input.borrowerUserId,
    },
    postings: [
      { accountId: chamaPool.id, debit: amount },
      { accountId: memberWallet.id, credit: amount },
      { accountId: principalReceivable.id, debit: amount },
      { accountId: chamaPool.id, credit: amount },
    ],
  });

  return { transferId };
}

/**
 * Loan repayment: borrower wallet → chama pool, clearing principal and
 * recognising interest revenue (which lands in the chama pool, since interest
 * belongs to the group).
 *   DR member_wallet                / CR loan_principal_receivable   (principal cleared)
 *   DR member_wallet                / CR loan_interest_receivable    (interest cleared)
 *   DR loan_principal_receivable    / CR chama_pool_wallet           (cash to chama for principal)
 *   DR loan_interest_receivable     / CR chama_pool_wallet           (cash to chama for interest)
 *
 * If interest is zero the interest legs are omitted.
 */
export async function recordLoanRepayment(input: {
  chamaId: string;
  borrowerUserId: string;
  principalKes: Decimal | string | number;
  interestKes: Decimal | string | number;
  idempotencyKey: string;
}): Promise<{ transferId: string }> {
  const principal = toDecimal(input.principalKes);
  const interest = toDecimal(input.interestKes);
  if (principal.lt(0) || interest.lt(0)) {
    throw new Error("Repayment amounts cannot be negative");
  }
  if (principal.plus(interest).lte(0)) {
    throw new Error("Repayment must include at least one of principal or interest > 0");
  }

  const [memberWallet, chamaPool, principalReceivable, interestReceivable] = await Promise.all([
    getOrCreateMemberWallet(input.borrowerUserId),
    getOrCreateChamaPoolWallet(input.chamaId),
    getOrCreateLoanReceivable("loan_principal_receivable", input.chamaId, input.borrowerUserId),
    getOrCreateLoanReceivable("loan_interest_receivable", input.chamaId, input.borrowerUserId),
  ]);

  const postings: Posting[] = [];

  // Net effect on member wallet: it's both debited (paying) and we credit two
  // receivables. Keep the legs explicit so the audit trail is readable.
  if (principal.gt(0)) {
    postings.push({ accountId: memberWallet.id, debit: principal });
    postings.push({ accountId: principalReceivable.id, credit: principal });
    postings.push({ accountId: principalReceivable.id, debit: principal });
    postings.push({ accountId: chamaPool.id, credit: principal });
  }
  if (interest.gt(0)) {
    postings.push({ accountId: memberWallet.id, debit: interest });
    postings.push({ accountId: interestReceivable.id, credit: interest });
    postings.push({ accountId: interestReceivable.id, debit: interest });
    postings.push({ accountId: chamaPool.id, credit: interest });
  }

  const { transferId } = await postTransfer({
    idempotencyKey: input.idempotencyKey,
    metadata: {
      kind: "loan_repayment",
      chamaId: input.chamaId,
      borrowerUserId: input.borrowerUserId,
      principal: principal.toString(),
      interest: interest.toString(),
    },
    postings,
  });

  return { transferId };
}

/**
 * Post the inverse of an existing transfer. Idempotent on the supplied
 * reversal `idempotencyKey`.
 */
export async function recordReversal(
  originalTransferId: string,
  reason: string,
  idempotencyKey: string,
): Promise<{ transferId: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const originalEntries = (await db.ledgerEntry.findMany({
    where: { transferId: originalTransferId },
    orderBy: { createdAt: "asc" },
  })) as LedgerEntry[];
  if (originalEntries.length === 0) {
    throw new Error(`recordReversal: no entries found for transferId=${originalTransferId}`);
  }

  const postings: Posting[] = originalEntries.map((e) => ({
    accountId: e.accountId,
    // swap debit and credit
    debit: toDecimal(e.credit),
    credit: toDecimal(e.debit),
  }));

  const { transferId } = await postTransfer({
    idempotencyKey,
    metadata: {
      kind: "reversal",
      reversesTransferId: originalTransferId,
      reason,
    },
    postings,
  });

  return { transferId };
}

// ── Invariant check ──────────────────────────────────────────────────

export async function verifyGlobalBalance(): Promise<{
  balanced: boolean;
  debitTotal: Decimal;
  creditTotal: Decimal;
  difference: Decimal;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const agg = await db.ledgerEntry.aggregate({
    _sum: { debit: true, credit: true },
  });
  const debitTotal = toDecimal(agg._sum?.debit);
  const creditTotal = toDecimal(agg._sum?.credit);
  const difference = debitTotal.minus(creditTotal);
  return {
    balanced: difference.equals(0),
    debitTotal,
    creditTotal,
    difference,
  };
}
