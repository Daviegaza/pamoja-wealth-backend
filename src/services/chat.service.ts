import { prisma } from "../config/database.js";

export async function getMessages(chamaId: string, before?: string, limit = 50) {
  const where: any = { chamaId };
  if (before) {
    where.createdAt = { lt: new Date(before) };
  }

  const messages = await prisma.chatMessage.findMany({
    where,
    include: {
      user: { select: { id: true, fullName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return messages.reverse().map((m) => ({
    id: m.id,
    chamaId: m.chamaId,
    userId: m.userId,
    userName: m.user.fullName,
    userAvatar: m.user.avatarUrl,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function sendMessage(chamaId: string, userId: string, content: string) {
  const message = await prisma.chatMessage.create({
    data: { chamaId, userId, content },
    include: {
      user: { select: { id: true, fullName: true, avatarUrl: true } },
    },
  });

  return {
    id: message.id,
    chamaId: message.chamaId,
    userId: message.userId,
    userName: message.user.fullName,
    userAvatar: message.user.avatarUrl,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}
