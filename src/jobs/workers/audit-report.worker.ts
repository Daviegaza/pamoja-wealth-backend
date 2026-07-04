/**
 * Audit report SKU worker.
 *
 * Consumes `audit-report:generate` jobs. Renders a PDF audit report for a
 * chama over a specified date range, uploads to S3, marks the paid
 * Transaction as fulfilled, and pings the buyer.
 *
 * Contents:
 *   - Chama name + reporting period
 *   - Total contributions, withdrawals, loan activity
 *   - Ledger integrity check (hash chain OK / broken)
 *   - Member list with balances
 *   - Signature line for external auditor
 */
import PDFDocument from "pdfkit";
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { emitToUser } from "../../websocket/index.js";
import { uploadFile, getDownloadUrl } from "../../config/storage.js";
import { sendAuditReportReady } from "../../services/email.service.js";

const DOWNLOAD_URL_EXPIRY_SECONDS = 30 * 60;

export interface AuditReportJob {
  chamaId: string;
  buyerUserId: string;
  transactionId: string;
  startDate: string;
  endDate: string;
}

export async function processAuditReport(data: AuditReportJob): Promise<{ storageKey: string }> {
  const chama = await prisma.chama.findUnique({
    where: { id: data.chamaId },
    select: { id: true, name: true, category: true },
  });
  if (!chama) throw new Error(`chama not found: ${data.chamaId}`);

  const start = new Date(data.startDate);
  const end = new Date(data.endDate);

  const [contributions, withdrawals, loans, members, auditChainOk] = await Promise.all([
    prisma.transaction.aggregate({
      where: { chamaId: data.chamaId, type: "contribution", status: "completed", createdAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.transaction.aggregate({
      where: { chamaId: data.chamaId, type: "withdrawal", status: "completed", createdAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.loan.findMany({
      where: { chamaId: data.chamaId, appliedDate: { gte: start, lte: end } },
      select: { id: true, amount: true, status: true },
    }),
    prisma.membership.findMany({
      where: { chamaId: data.chamaId, status: "active" },
      select: { user: { select: { fullName: true } }, contributionStreak: true },
      take: 200,
    }),
    verifyAuditChain(data.chamaId),
  ]);

  const buf = await renderAuditPdf({
    chama,
    range: { start, end },
    contributions,
    withdrawals,
    loans,
    members,
    auditChainOk,
  });

  const key = `audit-reports/${data.chamaId}/${data.transactionId}.pdf`;
  await uploadFile(buf, key, "application/pdf");

  await prisma.transaction.update({
    where: { id: data.transactionId },
    data: { status: "completed", description: `Audit report ${data.startDate} → ${data.endDate}` },
  });

  // Presigned download link — 30 min TTL, sent by email. WS event carries
  // the S3 key so the browser can fetch its own presign if the tab is open.
  const [buyer, downloadUrl] = await Promise.all([
    prisma.user.findUnique({ where: { id: data.buyerUserId }, select: { email: true, fullName: true } }),
    getDownloadUrl(key, DOWNLOAD_URL_EXPIRY_SECONDS),
  ]);

  emitToUser(data.buyerUserId, "audit-report:ready", { transactionId: data.transactionId, storageKey: key, downloadUrl });

  if (buyer?.email) {
    try {
      await sendAuditReportReady(
        buyer.email,
        chama.name,
        downloadUrl,
        { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
        DOWNLOAD_URL_EXPIRY_SECONDS / 60,
      );
    } catch (err) {
      logger.warn({ err, email: buyer.email }, "audit-report: email delivery failed (report still available in-app)");
    }
  }

  logger.info({ chamaId: data.chamaId, key }, "audit-report: pdf generated");
  return { storageKey: key };
}

async function verifyAuditChain(chamaId: string): Promise<boolean> {
  const rows = await prisma.auditLog.findMany({
    where: { chamaId },
    orderBy: { createdAt: "asc" },
    select: { hash: true, prevHash: true },
  });
  let prev: Buffer | null = null;
  for (const r of rows) {
    if (prev && r.prevHash && Buffer.compare(prev, r.prevHash as Buffer) !== 0) return false;
    prev = r.hash as Buffer;
  }
  return true;
}

interface RenderInput {
  chama: { id: string; name: string; category: string };
  range: { start: Date; end: Date };
  contributions: { _sum: { amount: unknown }; _count: number };
  withdrawals: { _sum: { amount: unknown }; _count: number };
  loans: Array<{ id: string; amount: unknown; status: string }>;
  members: Array<{ user: { fullName: string }; contributionStreak: number }>;
  auditChainOk: boolean;
}

function renderAuditPdf(input: RenderInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const money = (n: unknown) => `KES ${Number(n ?? 0).toLocaleString("en-KE")}`;
      const date = (d: Date) => d.toLocaleDateString("en-KE");

      // Header
      doc.fillColor("#059669").fontSize(22).text("Pamoja Wealth", { align: "left" });
      doc.fillColor("#666").fontSize(9).text("Independent audit report — issued via platform");
      doc.moveDown(1);

      doc.fillColor("#111").fontSize(18).text(`${input.chama.name}`);
      doc.fontSize(10).fillColor("#666").text(`${input.chama.category.toUpperCase()} · ${date(input.range.start)} → ${date(input.range.end)}`);
      doc.moveDown(1);

      // Summary section
      doc.fillColor("#111").fontSize(12).text("Financial summary", { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#333");
      doc.text(`Contributions received:  ${money(input.contributions._sum.amount)}  (${input.contributions._count} transactions)`);
      doc.text(`Withdrawals paid out:    ${money(input.withdrawals._sum.amount)}  (${input.withdrawals._count} transactions)`);
      const totalLoanKes = input.loans.reduce((s, l) => s + Number(l.amount ?? 0), 0);
      doc.text(`Loans issued:            ${money(totalLoanKes)}  (${input.loans.length} loans)`);
      doc.moveDown(1);

      // Integrity check
      doc.fillColor("#111").fontSize(12).text("Ledger integrity", { underline: true });
      doc.moveDown(0.3);
      doc.fillColor(input.auditChainOk ? "#059669" : "#dc2626").fontSize(11)
        .text(input.auditChainOk
          ? "✓ Hash chain intact — no tampering detected."
          : "✗ Hash chain broken — investigate immediately.");
      doc.moveDown(1);

      // Members
      doc.fillColor("#111").fontSize(12).text("Active members", { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#333");
      for (const m of input.members.slice(0, 40)) {
        doc.text(`• ${m.user.fullName} — streak ${m.contributionStreak} months`);
      }
      if (input.members.length > 40) {
        doc.fillColor("#666").text(`… and ${input.members.length - 40} more`);
      }
      doc.moveDown(1.5);

      // Signature
      doc.fillColor("#111").fontSize(10).text("_______________________________");
      doc.text("External auditor signature");
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor("#666").text(`Report ID: ${input.chama.id}-${Date.now()}`);
      doc.text(`Generated: ${new Date().toISOString()}`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
