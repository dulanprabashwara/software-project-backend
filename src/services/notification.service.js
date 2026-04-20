const prisma = require("../config/prisma");

/**
 * Creates a notification and emits it to the user's existing socket room.
 * @param {import('express').Application} app - The express app (to access io)
 * @param {Object} data - Notification data
 */
const createNotification = async (app, { type, title, message, link, userId, actorId }) => {
  try {
    // Don't notify the user of their own actions
    if (userId === actorId) return null;

    // 1. Save to Database
    const notification = await prisma.notification.create({
      data: { type, title, message, link, userId, actorId },
    });

    // 2. Emit instantly via Socket.io using YOUR exact room syntax
    const io = app.get("io");
    if (io) {
      io.to(`user:${userId}`).emit("notification:receive", notification);
    }

    return notification;
  } catch (error) {
    console.error("Failed to create notification:", error);
    // Return null instead of throwing so it doesn't break the main route logic
    return null; 
  }
};

module.exports = { createNotification };