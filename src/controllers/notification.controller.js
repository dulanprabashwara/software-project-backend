const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const notificationService = require("../services/notification.service");
const { parsePagination } = require("../utils/helpers");

/**
 * GET /api/v1/notifications
 * Get current user's notifications.
 */
const getNotifications = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { notifications, total, unreadCount } =
    await notificationService.getUserNotifications(req.user.id, page, limit);

  sendPaginated(res, {
    data: { notifications, unreadCount },
    page,
    limit,
    total,
  });
});

/**
 * PUT /api/v1/notifications/read
 * Mark notifications as read.
 */
const markAsRead = asyncHandler(async (req, res) => {
  const { notificationIds } = req.body; // null = mark all
  await notificationService.markAsRead(req.user.id, notificationIds);

  sendSuccess(res, { message: "Notifications marked as read." });
});

module.exports = { getNotifications, markAsRead };
