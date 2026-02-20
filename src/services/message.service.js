const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

/**
 * Get conversation history between two users.
 */
const getConversation = async (userId, otherUserId, page = 1, limit = 50) => {
  const skip = (page - 1) * limit;

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { sentAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.message.count({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
    }),
  ]);

  return { messages: messages.reverse(), total };
};

/**
 * Get list of conversations (latest message from each unique user).
 */
const getConversationList = async (userId) => {
  // Get all unique users the current user has exchanged messages with
  const sent = await prisma.message.findMany({
    where: { senderId: userId },
    select: { receiverId: true },
    distinct: ["receiverId"],
  });

  const received = await prisma.message.findMany({
    where: { receiverId: userId },
    select: { senderId: true },
    distinct: ["senderId"],
  });

  // Combine unique user IDs
  const userIds = new Set([
    ...sent.map((m) => m.receiverId),
    ...received.map((m) => m.senderId),
  ]);

  const conversations = [];

  for (const otherUserId of userIds) {
    // Get the latest message in each conversation
    const lastMessage = await prisma.message.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
      orderBy: { sentAt: "desc" },
    });

    // Count unread messages from this user
    const unreadCount = await prisma.message.count({
      where: {
        senderId: otherUserId,
        receiverId: userId,
        isRead: false,
      },
    });

    // Get the other user's info
    const otherUser = await prisma.user.findUnique({
      where: { id: otherUserId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        isOnline: true,
        lastSeen: true,
      },
    });

    conversations.push({
      user: otherUser,
      lastMessage,
      unreadCount,
    });
  }

  // Sort by latest message
  conversations.sort(
    (a, b) =>
      new Date(b.lastMessage.sentAt).getTime() -
      new Date(a.lastMessage.sentAt).getTime(),
  );

  return conversations;
};

/**
 * Mark all messages from a sender as read.
 */
const markAsRead = async (userId, senderId) => {
  await prisma.message.updateMany({
    where: {
      senderId,
      receiverId: userId,
      isRead: false,
    },
    data: { isRead: true },
  });
};

/**
 * Get total unread message count.
 */
const getUnreadCount = async (userId) => {
  const count = await prisma.message.count({
    where: {
      receiverId: userId,
      isRead: false,
    },
  });
  return count;
};

module.exports = {
  getConversation,
  getConversationList,
  markAsRead,
  getUnreadCount,
};
