const prisma = require("../config/prisma");

/**
 * Create a notification.
 */
const createNotification = async ({
  userId,
  type,
  title,
  message,
  link,
  actorId,
}) => {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      link: link || null,
      actorId: actorId || null,
    },
  });

  return notification;
};

/**
 * Get user's notifications with pagination.
 */
const getUserNotifications = async (userId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { notifications, total, unreadCount };
};

/**
 * Mark notification(s) as read.
 */
const markAsRead = async (userId, notificationIds = null) => {
  const where = { userId };
  if (notificationIds) {
    where.id = { in: notificationIds };
  }

  await prisma.notification.updateMany({
    where,
    data: { isRead: true },
  });
};

/**
 * Delete old notifications (older than 30 days).
 */
const cleanupOldNotifications = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: thirtyDaysAgo },
      isRead: true,
    },
  });

  return { deletedCount: result.count };
};

module.exports = {
  createNotification,
  getUserNotifications,
  markAsRead,
  cleanupOldNotifications,
};
