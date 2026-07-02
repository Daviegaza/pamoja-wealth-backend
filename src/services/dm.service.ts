import { prisma } from "../config/database.js";
import * as notifications from "./notifications.service.js";

export async function listConversations(userId: string) {
  const messages = await prisma.directMessage.findMany({
    where: { OR: [{ senderId: userId }, { recipientId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      sender: { select: { id: true, fullName: true, avatarUrl: true } },
      recipient: { select: { id: true, fullName: true, avatarUrl: true } },
    },
  });

  const byPeer = new Map<string, {
    peerId: string;
    peerName: string;
    peerAvatar: string | null;
    lastMessage: string;
    lastAt: string;
    unread: number;
  }>();

  for (const m of messages) {
    const isSender = m.senderId === userId;
    const peer = isSender ? m.recipient : m.sender;
    const key = peer.id;
    if (!byPeer.has(key)) {
      byPeer.set(key, {
        peerId: peer.id,
        peerName: peer.fullName,
        peerAvatar: peer.avatarUrl,
        lastMessage: m.content,
        lastAt: m.createdAt.toISOString(),
        unread: 0,
      });
    }
    const c = byPeer.get(key)!;
    if (!isSender && !m.readAt) c.unread += 1;
  }
  return Array.from(byPeer.values());
}

export async function getMessages(userId: string, peerId: string) {
  const msgs = await prisma.directMessage.findMany({
    where: {
      OR: [
        { senderId: userId, recipientId: peerId },
        { senderId: peerId, recipientId: userId },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 500,
    include: {
      sender: { select: { id: true, fullName: true, avatarUrl: true } },
    },
  });
  return msgs.map((m) => ({
    id: m.id,
    senderId: m.senderId,
    recipientId: m.recipientId,
    senderName: m.sender.fullName,
    senderAvatar: m.sender.avatarUrl,
    content: m.content,
    readAt: m.readAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function send(senderId: string, recipientId: string, content: string) {
  if (!content || !content.trim()) throw new Error("Message content required");
  if (senderId === recipientId) throw new Error("Cannot send message to yourself");
  const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { fullName: true } });
  const msg = await prisma.directMessage.create({
    data: { senderId, recipientId, content: content.trim() },
    include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
  });
  try {
    await notifications.create(
      recipientId,
      "info",
      `Message from ${sender?.fullName ?? "someone"}`,
      content.slice(0, 140),
      `/messages?peer=${senderId}`,
    );
  } catch { /* non-blocking */ }
  return {
    id: msg.id,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    senderName: msg.sender.fullName,
    senderAvatar: msg.sender.avatarUrl,
    content: msg.content,
    readAt: null,
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function markRead(userId: string, peerId: string) {
  const now = new Date();
  const r = await prisma.directMessage.updateMany({
    where: { senderId: peerId, recipientId: userId, readAt: null },
    data: { readAt: now },
  });
  return { updated: r.count };
}
