const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

/**
 * Get conversation history and message count between two users.
 */
const getConversation = async (userId, otherUserId, page = 1, limit = 50) => {
  const skip = (page - 1) * limit;

  const messages = await prisma.message.findMany({
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
  });

  return { messages: messages.reverse() };
};

/**
 * Get list of conversations and latest message from each conversation to display in the sidebar
 */
const getConversationList = async (userId) => {
  // find the ID of every single person you have chatted with
  const [sent, received] = await Promise.all([
    prisma.message.findMany({
      where: { senderId: userId },
      select: { receiverId: true },
      distinct: ["receiverId"],
    }),
    prisma.message.findMany({
      where: { receiverId: userId },
      select: { senderId: true },
      distinct: ["senderId"],
    }),
  ]);

  // Combine unique user IDs
  const userIds = new Set([
    ...sent.map((m) => m.receiverId),
    ...received.map((m) => m.senderId),
  ]);

  // Run all per-conversation queries in parallel instead of one-by-one
  const conversations = await Promise.all(
    [...userIds].map(async (otherUserId) => {
      const [lastMessage, unreadCount, otherUser] = await Promise.all([
        // Get the latest message in each conversation
        prisma.message.findFirst({
          where: {
            OR: [
              { senderId: userId, receiverId: otherUserId },
              { senderId: otherUserId, receiverId: userId },
            ],
          },
          orderBy: { sentAt: "desc" },
        }),

        //get unread message count that the other user sent to you
        prisma.message.count({
          where: {
            senderId: otherUserId,
            receiverId: userId,
            isRead: false,
          },
        }),

        // Get the other user's info
        prisma.user.findUnique({
          where: { id: otherUserId },
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            isOnline: true,
            lastSeen: true,
          },
        }),
      ]);

      return { user: otherUser, lastMessage, unreadCount };
    }),
  );

  // Sort conversations list by the most recent message
  conversations.sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.sentAt).getTime() : 0;
    const timeB = b.lastMessage ? new Date(b.lastMessage.sentAt).getTime() : 0;
    return timeB - timeA;
  });

  return conversations;
};

/**
 * Mark all messages from a sender as read when open the chat
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
 * Get total unread message count across all chats
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
