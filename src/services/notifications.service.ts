import { prisma } from "../config/database.js";

export async function create(
  userId: string,
  type: string,
  title: string,
  message: string,
  actionUrl?: string
) {
  return prisma.notification.create({
    data: { userId, type: type as any, title, message, actionUrl: actionUrl || null },
  });
}

export async function list(userId: string, query: {
  unreadOnly?: boolean | string;
  page?: number | string;
  pageSize?: number | string;
}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const unreadOnly = query.unreadOnly === true || query.unreadOnly === "true";

  const where: any = { userId };
  if (unreadOnly) where.isRead = false;

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    items: items.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: n.isRead,
      actionUrl: n.actionUrl,
      createdAt: n.createdAt.toISOString(),
    })),
    total,
    unreadCount,
    page,
    pageSize,
  };
}

export async function markAsRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

export async function markAllAsRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return { success: true };
}

export async function remove(userId: string, notificationId: string) {
  await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });
  return { success: true };
}
