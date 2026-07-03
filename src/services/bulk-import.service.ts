/**
 * Bulk CSV/Excel import — contributions and members.
 *
 * Parse-then-preview-then-commit flow:
 *   1. FE POSTs CSV/XLSX buffer to /chamas/:id/import/preview → server returns
 *      parsed rows + per-row validation (dry run, no writes)
 *   2. FE lets user fix issues, then POSTs the accepted rows to
 *      /chamas/:id/import/commit → server writes in a single transaction.
 *
 * Supported files:
 *   - CSV (RFC 4180)
 *   - XLSX (first sheet only)
 *
 * Templates: /chamas/:id/import/template.csv?type=contributions|members
 */
import { z } from "zod";
import * as xlsx from "xlsx";
import { prisma } from "../config/database.js";

export type ImportType = "contributions" | "members";

const contributionRowSchema = z.object({
  memberEmail: z.string().email().optional(),
  memberPhone: z.string().optional(),
  amount: z.coerce.number().positive(),
  date: z.coerce.date().optional(),
  reference: z.string().optional(),
  method: z.enum(["mpesa", "bank", "card", "cash"]).default("cash"),
  memo: z.string().optional(),
}).refine((r) => r.memberEmail || r.memberPhone, { message: "email or phone required" });

const memberRowSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(9),
  fullName: z.string().min(2),
  role: z.enum(["member", "treasurer", "secretary", "chairperson", "admin"]).default("member"),
});

type ContributionRow = z.infer<typeof contributionRowSchema>;
type MemberRow = z.infer<typeof memberRowSchema>;

export interface PreviewResult {
  type: ImportType;
  totalRows: number;
  validRows: unknown[];
  errors: Array<{ row: number; message: string }>;
}

function parseWorkbook(buf: Buffer, mimeType: string): Record<string, string>[] {
  if (mimeType.includes("csv") || mimeType === "text/plain") {
    const wb = xlsx.read(buf.toString("utf8"), { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return xlsx.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  }
  const wb = xlsx.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
}

export function preview(buf: Buffer, mimeType: string, type: ImportType): PreviewResult {
  const rows = parseWorkbook(buf, mimeType);
  const schema = type === "contributions" ? contributionRowSchema : memberRowSchema;
  const valid: unknown[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  rows.forEach((row, idx) => {
    const parsed = schema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
    else errors.push({ row: idx + 2, message: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ") });
  });
  return { type, totalRows: rows.length, validRows: valid, errors };
}

export async function commitContributions(chamaId: string, rows: ContributionRow[], createdById: string): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const user = await tx.user.findFirst({
        where: {
          OR: [
            row.memberEmail ? { email: row.memberEmail } : {},
            row.memberPhone ? { phone: row.memberPhone } : {},
          ].filter((c) => Object.keys(c).length > 0),
        },
      });
      if (!user) { skipped++; continue; }
      const membership = await tx.membership.findFirst({ where: { chamaId, userId: user.id } });
      if (!membership) { skipped++; continue; }
      await tx.transaction.create({
        data: {
          chamaId,
          userId: user.id,
          type: "contribution",
          amount: row.amount,
          balanceAfter: 0,
          method: row.method,
          reference: row.reference ?? `IMP-${Date.now()}-${inserted}`,
          description: row.memo ?? "Bulk import",
          status: "completed",
          createdAt: row.date ?? new Date(),
        },
      });
      await tx.membership.update({
        where: { id: membership.id },
        data: { totalContributions: { increment: row.amount } },
      });
      inserted++;
    }
    await tx.auditLog.create({
      data: {
        userId: createdById,
        chamaId,
        action: "bulk_import.contributions",
        entityType: "Transaction",
        entityId: `${inserted}-rows`,
        details: { inserted, skipped } as unknown as object,
        hash: new Uint8Array(Buffer.from(`bulk:${chamaId}:${Date.now()}`)),
      },
    });
  });
  return { inserted, skipped };
}

export async function commitMembers(chamaId: string, rows: MemberRow[], createdById: string): Promise<{ invited: number; skipped: number }> {
  let invited = 0;
  let skipped = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const existing = await tx.user.findFirst({
        where: { OR: [{ email: row.email }, { phone: row.phone }] },
      });
      // We only create invitations here — actual signup happens when user clicks the link.
      if (existing) {
        const alreadyMember = await tx.membership.findFirst({
          where: { chamaId, userId: existing.id },
        });
        if (alreadyMember) { skipped++; continue; }
      }
      await tx.invitation.create({
        data: {
          chamaId,
          invitedById: createdById,
          inviteeUserId: existing?.id,
          inviteePhone: row.phone,
          inviteeEmail: row.email,
          method: existing ? "username" : "email",
          token: Buffer.from(`${chamaId}:${row.email}:${Date.now()}`).toString("base64url"),
          status: "pending",
          expiresAt: new Date(Date.now() + 14 * 86400_000),
        },
      });
      invited++;
    }
  });
  return { invited, skipped };
}

export function buildTemplate(type: ImportType): { filename: string; body: string } {
  if (type === "contributions") {
    return {
      filename: "contributions_template.csv",
      body: "memberEmail,memberPhone,amount,date,reference,method,memo\n" +
        "jane@example.com,+254712345678,1000,2026-01-15,PW123ABC,mpesa,Jan contribution\n",
    };
  }
  return {
    filename: "members_template.csv",
    body: "email,phone,fullName,role\n" +
      "jane@example.com,+254712345678,Jane Doe,member\n",
  };
}
