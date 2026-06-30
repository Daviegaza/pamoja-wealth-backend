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
  unreadOnly?: boolean;
  page: number;
  pageSize: number;
}) {
  const where: any = { userId };
  if (query.unreadOnly) where.isRead = false;

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
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
    page: query.page,
    pageSize: query.pageSize,
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
