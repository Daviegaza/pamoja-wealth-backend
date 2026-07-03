/**
 * Ledger export — CSV / QuickBooks IIF / Xero-compatible CSV.
 *
 * Reads LedgerEntry + LedgerAccount for a chama in a date range and emits
 * one of three formats. Called from GET /chamas/:id/ledger/export?format=xxx.
 */
import { prisma } from "../config/database.js";

export type ExportFormat = "csv" | "quickbooks" | "xero";

interface ExportOpts {
  chamaId: string;
  startDate: Date;
  endDate: Date;
  format: ExportFormat;
}

interface LedgerRow {
  date: string;
  transferId: string;
  accountType: string;
  accountOwner: string;
  debit: number;
  credit: number;
  currency: string;
  reference: string;
  memo: string;
}

async function loadRows(opts: ExportOpts): Promise<LedgerRow[]> {
  const memberUserIds = (await prisma.membership.findMany({
    where: { chamaId: opts.chamaId },
    select: { userId: true },
  })).map((m) => m.userId);

  // Pre-load accounts scoped to this chama + its members.
  const accounts = await prisma.ledgerAccount.findMany({
    where: {
      OR: [
        { ownerChamaId: opts.chamaId },
        {
          AND: [
            { type: { in: ["member_wallet"] } },
            { ownerUserId: { in: memberUserIds } },
          ],
        },
      ],
    },
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const entries = await prisma.ledgerEntry.findMany({
    where: {
      createdAt: { gte: opts.startDate, lte: opts.endDate },
      accountId: { in: accounts.map((a) => a.id) },
    },
    orderBy: { createdAt: "asc" },
  });

  return entries.map((e) => {
    const acct = accountById.get(e.accountId);
    return {
      date: e.createdAt.toISOString().slice(0, 10),
      transferId: e.transferId ?? "",
      accountType: acct?.type ?? "",
      accountOwner: acct?.ownerChamaId ?? acct?.ownerUserId ?? "",
      debit: Number(e.debit ?? 0),
      credit: Number(e.credit ?? 0),
      currency: e.currency ?? "KES",
      reference: e.providerRef ?? e.mpesaReceipt ?? "",
      memo: (e.metadata as Record<string, unknown>)?.memo as string ?? "",
    };
  });
}

function toCsv(rows: LedgerRow[]): string {
  const header = "Date,TransferID,AccountType,AccountOwner,Debit,Credit,Currency,Reference,Memo\n";
  const body = rows.map((r) =>
    [r.date, r.transferId, r.accountType, r.accountOwner, r.debit, r.credit, r.currency, r.reference, csvEscape(r.memo)].join(","),
  ).join("\n");
  return header + body + "\n";
}

function csvEscape(s: string): string {
  if (!s) return "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// QuickBooks IIF (Intuit Interchange Format) — plaintext double-entry.
function toQuickbooksIif(rows: LedgerRow[]): string {
  const acctTypeMap: Record<string, string> = {
    member_wallet: "BANK",
    chama_pool_wallet: "BANK",
    fundraiser_escrow: "BANK",
    loan_principal_receivable: "AR",
    loan_interest_receivable: "AR",
    platform_fee_revenue: "INC",
    mpesa_clearing: "BANK",
    suspense: "OASSET",
  };
  const header = [
    "!ACCNT\tNAME\tACCNTTYPE",
    "!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO",
    "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO",
    "!ENDTRNS",
  ].join("\n");

  const acctLines = Array.from(new Set(rows.map((r) => r.accountType)))
    .map((t) => `ACCNT\t${t}\t${acctTypeMap[t] ?? "OASSET"}`)
    .join("\n");

  const trns = rows.map((r) => {
    const amt = r.debit - r.credit;
    return [
      `TRNS\t${r.transferId}\tGENERAL JOURNAL\t${r.date}\t${r.accountType}\t${amt.toFixed(2)}\t${r.memo}`,
      `SPL\t\tGENERAL JOURNAL\t${r.date}\t${r.accountType}\t${(-amt).toFixed(2)}\t${r.memo}`,
      "ENDTRNS",
    ].join("\n");
  }).join("\n");

  return `${header}\n${acctLines}\n${trns}\n`;
}

// Xero — bank statement import CSV (Xero accepts *Date, *Amount, Payee, Description, Reference).
function toXeroCsv(rows: LedgerRow[]): string {
  const header = "*Date,*Amount,Payee,Description,Reference\n";
  const body = rows.map((r) => {
    const amt = r.debit - r.credit;
    return [r.date, amt.toFixed(2), csvEscape(r.accountOwner), csvEscape(r.memo), r.reference].join(",");
  }).join("\n");
  return header + body + "\n";
}

export async function exportLedger(opts: ExportOpts): Promise<{ filename: string; contentType: string; body: string }> {
  const rows = await loadRows(opts);
  const dateTag = `${opts.startDate.toISOString().slice(0, 10)}_${opts.endDate.toISOString().slice(0, 10)}`;
  switch (opts.format) {
    case "quickbooks":
      return { filename: `ledger_${dateTag}.iif`, contentType: "text/plain", body: toQuickbooksIif(rows) };
    case "xero":
      return { filename: `ledger_${dateTag}_xero.csv`, contentType: "text/csv", body: toXeroCsv(rows) };
    case "csv":
    default:
      return { filename: `ledger_${dateTag}.csv`, contentType: "text/csv", body: toCsv(rows) };
  }
}
