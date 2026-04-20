const prisma = require("../config/prisma");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");

// GET /api/notifications
const getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id; // From authenticate middleware

  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      // We include the actor (the person who followed/commented)
      // Article ratings are anonymous, so actorId might be null there.
      user: {
        select: { displayName: true, avatarUrl: true }
      }
    },
    take: 20 // Limit to last 20
  });

  sendSuccess(res, { data: notifications });
});

// PATCH /api/notifications/:id/read
const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const notification = await prisma.notification.update({
    where: { id, userId }, // Ensure user owns the notification
    data: { isRead: true }
  });

  sendSuccess(res, { data: notification });
});

module.exports = { getNotifications, markAsRead };