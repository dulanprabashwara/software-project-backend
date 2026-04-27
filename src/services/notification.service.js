const prisma = require("../config/prisma");

const createNotification = async (app, { type, destUserId, sourceUserId, sourceArticleId }) => {
 console.log(`🔔 Notif Triggered: Type=${type}, To=${destUserId}, From=${sourceUserId}, Article=${sourceArticleId}`);
  try {
    // Don't notify the user of their own actions
    if (destUserId === sourceUserId) return null;

    // 1. Save to Database using ONLY your schema's fields
    const notification = await prisma.notification.create({
      data: { 
        type, 
        destUserId,
        sourceUserId,
        sourceArticleId
      },
      include: {
        // Fetch the related data so the frontend can build the message
        sourceUser: { select: { username: true, displayName: true, avatarUrl: true } },
        sourceArticle: { select: { title: true, slug: true } }
      }
    });

    // 2. Emit instantly via Socket.io
    const io = app.get("io");
    if (io) {
      io.to(`user:${destUserId}`).emit("notification:receive", notification);
    }

    return notification;
  } catch (error) {
    console.error("Failed to save notification:", error.message);
    return null; 
  }
};

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



module.exports ={ createNotification, 
                  fetchUserNotifications,
                  deleteNotifications 
                };