const prisma = require("../config/prisma");

const fetchUserNotifications = async (userId) => {
  return await prisma.notification.findMany({
    where: { destUserId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      sourceUser: { select: { username: true, displayName: true, avatarUrl: true } },
      sourceArticle: { select: { title: true, id: true } }
    }
  });
};

const deleteNotifications = async (userId, notificationId) => {
  // If a specific ID is provided, delete just that one. Otherwise, clear all.
  if (notificationId) {
    return await prisma.notification.deleteMany({
      where: { id: notificationId, destUserId: userId },
    });
  } else {
    return await prisma.notification.deleteMany({
      where: { destUserId: userId },
    });
  }
};

module.exports = {
  fetchUserNotifications,
  deleteNotifications
};