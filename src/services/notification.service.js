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

module.exports = { createNotification };