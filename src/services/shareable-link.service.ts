/**
 * Shareable donation + investment links.
 *
 * Anyone (no login) opens a link like https://pamojawealth.app/give/abc123 →
 * sees the cause + progress → enters amount + phone number → gets STK Push →
 * money lands in the chama's escrow. Donor optionally leaves a name + message.
 *
 * Powers three link types:
 *   - "donate"  → routes to Donation table (fundraiser / harambee)
 *   - "invest"  → routes to ShareOffering, allocates shares, updates cap table
 *   - "join"    → routes to Invitation model (existing)
 *
 * Storage is Redis-backed for shareable links themselves + Postgres for the
 * resulting Donation / Investment / Invitation rows. Schema migration for a
 * dedicated ShareableLink model can happen post-launch.
 */
import { redis } from "../config/redis.js";
import crypto from "crypto";
import QRCode from "qrcode";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";

export type LinkKind = "donate" | "invest" | "join";

export interface ShareableLink {
  token: string;
  kind: LinkKind;
  chamaId: string;
  createdById: string;
  createdAt: string;
  title?: string;
  description?: string;
  minAmountKes?: number;
  maxAmountKes?: number;
  targetAmountKes?: number;
  expiresAt?: string;
  disabled?: boolean;
  meta?: Record<string, unknown>;
}

function key(token: string): string {
  return `share:link:${token}`;
}

function chamaIndexKey(chamaId: string): string {
  return `share:chama:${chamaId}`;
}

export async function createLink(input: Omit<ShareableLink, "token" | "createdAt">): Promise<ShareableLink> {
  const token = crypto.randomBytes(9).toString("base64url"); // 12-char, URL-safe
  const link: ShareableLink = {
    ...input,
    token,
    createdAt: new Date().toISOString(),
  };
  await redis.set(key(token), JSON.stringify(link));
  await redis.sadd(chamaIndexKey(input.chamaId), token);
  logger.info({ token, chamaId: input.chamaId, kind: input.kind }, "shareable link created");
  return link;
}

export async function getLink(token: string): Promise<ShareableLink | null> {
  const raw = await redis.get(key(token));
  if (!raw) return null;
  const link = JSON.parse(raw) as ShareableLink;
  if (link.disabled) return null;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;
  return link;
}

export async function listLinks(chamaId: string): Promise<ShareableLink[]> {
  const tokens = await redis.smembers(chamaIndexKey(chamaId));
  const links: ShareableLink[] = [];
  for (const t of tokens) {
    const l = await redis.get(key(t));
    if (l) links.push(JSON.parse(l) as ShareableLink);
  }
  return links;
}

export async function disableLink(token: string): Promise<void> {
  const raw = await redis.get(key(token));
  if (!raw) return;
  const link = JSON.parse(raw) as ShareableLink;
  link.disabled = true;
  await redis.set(key(token), JSON.stringify(link));
}

/**
 * Build the QR code as a data URL PNG. Consumers can embed it directly in
 * an <img src> or download it.
 */
export async function qrDataUrl(publicUrl: string): Promise<string> {
  return QRCode.toDataURL(publicUrl, {
    width: 512,
    margin: 2,
    color: { dark: "#059669", light: "#ffffff" },
    errorCorrectionLevel: "H",
  });
}

export async function qrBuffer(publicUrl: string): Promise<Buffer> {
  return QRCode.toBuffer(publicUrl, {
    width: 512,
    margin: 2,
    color: { dark: "#059669", light: "#ffffff" },
    errorCorrectionLevel: "H",
  });
}

/**
 * Public preview payload — safe for anonymous consumers. No PII exposed.
 * Aggregates progress against target if set.
 */
export async function publicPreview(token: string): Promise<{
  ok: boolean;
  link?: ShareableLink;
  chama?: { name: string; description: string | null; logoUrl: string | null; category: string };
  progress?: { raisedKes: number; targetKes?: number; donorCount: number };
}> {
  const link = await getLink(token);
  if (!link) return { ok: false };

  const chama = await prisma.chama.findUnique({
    where: { id: link.chamaId },
    select: { name: true, description: true, logoUrl: true, category: true, raisedAmount: true, targetAmount: true },
  });
  if (!chama) return { ok: false };

  const donorCount = await prisma.donation.count({ where: { chamaId: link.chamaId } });

  return {
    ok: true,
    link,
    chama: { name: chama.name, description: chama.description, logoUrl: chama.logoUrl, category: chama.category },
    progress: {
      raisedKes: Number(chama.raisedAmount ?? 0),
      targetKes: link.targetAmountKes ?? (Number(chama.targetAmount ?? 0) || undefined),
      donorCount,
    },
  };
}
