const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const messageService = require("../services/message.service");
const { parsePagination } = require("../utils/helpers");

/**
 * GET /api/v1/messages/conversations
 * Get list of conversations.
 */
const getConversations = asyncHandler(async (req, res) => {
  const conversations = await messageService.getConversationList(req.user.id);

  sendSuccess(res, {
    message: "Conversations retrieved.",
    data: conversations,
  });
});

/**
 * GET /api/v1/messages/:userId
 * Get conversation history with a specific user.
 */
const getConversation = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { messages, total } = await messageService.getConversation(
    req.user.id,
    req.params.userId,
    page,
    limit,
  );

  sendPaginated(res, {
    data: messages,
    page,
    limit,
    total,
    message: "Messages retrieved.",
  });
});

/**
 * PUT /api/v1/messages/:userId/read
 * Mark all messages from a user as read.
 */
const markAsRead = asyncHandler(async (req, res) => {
  await messageService.markAsRead(req.user.id, req.params.userId);

  sendSuccess(res, { message: "Messages marked as read." });
});

/**
 * GET /api/v1/messages/unread/count
 * Get total unread message count.
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await messageService.getUnreadCount(req.user.id);

  sendSuccess(res, { data: { unreadCount: count } });
});

module.exports = {
  getConversations,
  getConversation,
  markAsRead,
  getUnreadCount,
};
