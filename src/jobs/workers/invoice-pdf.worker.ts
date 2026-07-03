/**
 * Invoice PDF worker.
 *
 * Consumes `invoice:generate-pdf` jobs from the `billing` queue. Renders the
 * invoice with PDFKit, uploads to S3 (already configured in src/config/storage.ts),
 * writes the S3 key back to Invoice.pdfStorageKey, and emits a WebSocket
 * event so the FE can enable the download button.
 *
 * Presigner: expose GET /api/v1/billing/invoices/:chamaId/:invoiceId.pdf that
 * fetches the key + returns a 60-second presigned S3 URL. Wired in
 * billing.controller.ts once this worker runs.
 */
import PDFDocument from "pdfkit";
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { emitToUser } from "../../websocket/index.js";
import { uploadFile } from "../../config/storage.js";

interface InvoicePdfJob {
  invoiceId: string;
}

export async function processInvoicePdf(data: InvoicePdfJob): Promise<{ storageKey: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: data.invoiceId },
    include: {
      subscription: {
        include: {
          chama: { select: { id: true, name: true, paybillAccountNumber: true } },
          plan: true,
        },
      },
    },
  });
  if (!invoice) throw new Error(`invoice not found: ${data.invoiceId}`);

  const buf = await renderInvoicePdf(invoice as unknown as Record<string, unknown>);
  const key = `invoices/${invoice.subscription.chamaId}/${invoice.number}.pdf`;
  await uploadFile(buf, key, "application/pdf");
  await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfStorageKey: key } });

  // Notify chama owner.
  const owner = await prisma.membership.findFirst({
    where: { chamaId: invoice.subscription.chamaId, role: "owner" },
    select: { userId: true },
  });
  if (owner) {
    emitToUser(owner.userId, "invoice:pdf-ready", { invoiceId: invoice.id, storageKey: key });
  }
  logger.info({ invoiceId: invoice.id, key }, "invoice pdf generated");
  return { storageKey: key };
}

function renderInvoicePdf(invoice: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const sub = invoice.subscription as Record<string, unknown> | undefined;
      const chama = sub?.chama as Record<string, unknown> | undefined;
      const plan = sub?.plan as Record<string, unknown> | undefined;

      // Header
      doc.fillColor("#059669").fontSize(24).text("Pamoja Wealth", { align: "left" });
      doc.moveDown(0.2);
      doc.fillColor("#666666").fontSize(10).text("Fintech Kenya — Serving East Africa's chamas");
      doc.moveDown(1.5);

      doc.fillColor("#111").fontSize(18).text(`Invoice #${invoice.number}`);
      doc.fontSize(10).fillColor("#666")
        .text(`Issued: ${new Date(String(invoice.createdAt)).toLocaleDateString()}`);
      doc.text(`Due: ${new Date(String(invoice.dueAt)).toLocaleDateString()}`);
      doc.moveDown(1);

      // Bill to
      doc.fontSize(11).fillColor("#111").text("Bill to:", { underline: true });
      doc.fillColor("#333").text(String(chama?.name ?? "—"));
      if (chama?.paybillAccountNumber) {
        doc.fontSize(9).fillColor("#666").text(`Paybill acct: ${chama.paybillAccountNumber}`);
      }
      doc.moveDown(1);

      // Line items
      doc.fontSize(11).fillColor("#111").text("Details", { underline: true });
      const pStart = new Date(String(invoice.periodStart)).toLocaleDateString();
      const pEnd = new Date(String(invoice.periodEnd)).toLocaleDateString();
      doc.fontSize(10).fillColor("#333").text(
        `${plan?.name ?? "Subscription"} — ${pStart} → ${pEnd}`,
      );
      doc.moveDown(1);

      // Totals
      const money = (n: unknown) => `KES ${Number(n ?? 0).toLocaleString("en-KE")}`;
      doc.fontSize(10);
      doc.text(`Subtotal:        ${money(invoice.amountKes)}`, { align: "right" });
      if (Number(invoice.discountKes ?? 0) > 0) {
        doc.text(`Discount:       −${money(invoice.discountKes)}`, { align: "right" });
      }
      if (Number(invoice.taxKes ?? 0) > 0) {
        doc.text(`VAT (16%):       ${money(invoice.taxKes)}`, { align: "right" });
      }
      doc.moveDown(0.3);
      doc.fontSize(13).fillColor("#059669")
        .text(`Total due:       ${money(invoice.totalKes)}`, { align: "right" });

      // Footer
      doc.moveDown(3);
      doc.fontSize(8).fillColor("#999").text(
        "Pay via M-Pesa Paybill 4123456. Account: Invoice number. Questions? billing@pamojawealth.com",
        { align: "center" },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
