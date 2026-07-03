/**
 * Chat upgrades — reactions, pinning, reply threads, search, read markers.
 *
 * Assumes migration chat_upgrades.sql has been applied. Uses raw SQL via
 * $queryRaw / $executeRaw where Prisma types haven't been regenerated yet.
 */
import { prisma } from "../config/database.js";
import { emitToChama } from "../websocket/index.js";
import { logger } from "../config/logger.js";
import crypto from "crypto";

export async function addReaction(messageId: string, userId: string, emoji: string): Promise<void> {
  const id = crypto.randomBytes(12).toString("hex");
  await prisma.$executeRaw`
    INSERT INTO "ChatReaction" ("id","messageId","userId","emoji","createdAt")
    VALUES (${id}, ${messageId}, ${userId}, ${emoji}, NOW())
    ON CONFLICT ("messageId","userId","emoji") DO NOTHING
  `;
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { chamaId: true } });
  if (msg?.chamaId) emitToChama(msg.chamaId, "chat:reaction", { messageId, userId, emoji, added: true });
}

export async function removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "ChatReaction"
    WHERE "messageId"=${messageId} AND "userId"=${userId} AND "emoji"=${emoji}
  `;
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { chamaId: true } });
  if (msg?.chamaId) emitToChama(msg.chamaId, "chat:reaction", { messageId, userId, emoji, added: false });
}

export async function pinMessage(messageId: string, userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ChatMessage" SET "pinnedAt"=NOW(), "pinnedById"=${userId}
    WHERE "id"=${messageId}
  `;
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { chamaId: true } });
  if (msg?.chamaId) emitToChama(msg.chamaId, "chat:pinned", { messageId, pinned: true });
}

export async function unpinMessage(messageId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ChatMessage" SET "pinnedAt"=NULL, "pinnedById"=NULL WHERE "id"=${messageId}
  `;
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { chamaId: true } });
  if (msg?.chamaId) emitToChama(msg.chamaId, "chat:pinned", { messageId, pinned: false });
}

export async function listPinned(chamaId: string): Promise<unknown[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatMessage"
    WHERE "chamaId"=${chamaId} AND "pinnedAt" IS NOT NULL AND "deletedAt" IS NULL
    ORDER BY "pinnedAt" DESC LIMIT 50
  `;
  return rows;
}

export async function searchMessages(chamaId: string, q: string, limit = 30): Promise<unknown[]> {
  if (!q.trim()) return [];
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatMessage"
    WHERE "chamaId"=${chamaId} AND "deletedAt" IS NULL AND "content" ILIKE ${"%" + q + "%"}
    ORDER BY "createdAt" DESC LIMIT ${limit}
  `;
  return rows;
}

export async function markRead(userId: string, chamaId: string, messageId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ChatReadMarker" ("userId","chamaId","lastReadMessageId","lastReadAt")
    VALUES (${userId}, ${chamaId}, ${messageId}, NOW())
    ON CONFLICT ("userId","chamaId") DO UPDATE SET "lastReadMessageId"=${messageId}, "lastReadAt"=NOW()
  `;
}

export async function unreadCount(userId: string, chamaId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM "ChatMessage" m
    LEFT JOIN "ChatReadMarker" r ON r."userId"=${userId} AND r."chamaId"=${chamaId}
    WHERE m."chamaId"=${chamaId}
      AND m."deletedAt" IS NULL
      AND m."userId"<>${userId}
      AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
  `;
  return rows[0]?.n ?? 0;
}

export async function softDelete(messageId: string, userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ChatMessage" SET "deletedAt"=NOW(), "content"='[deleted]'
    WHERE "id"=${messageId} AND "userId"=${userId}
  `;
}

export async function editMessage(messageId: string, userId: string, content: string): Promise<void> {
  const r = await prisma.$executeRaw`
    UPDATE "ChatMessage" SET "content"=${content}, "editedAt"=NOW()
    WHERE "id"=${messageId} AND "userId"=${userId} AND "deletedAt" IS NULL
  `;
  if (r === 0) logger.warn({ messageId, userId }, "chat edit failed: no match");
}
