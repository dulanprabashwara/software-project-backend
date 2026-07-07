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
 * Get list of conversations for sidebar  (latest message from each unique user).
 */
const getConversationList = async (userId) => {
  // 1. Single query: get the latest message for every conversation partner
  //    Uses raw SQL via Prisma for a efficient "latest message per group" pattern
  const allMessages = await prisma.message.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
    },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      content: true,
      sentAt: true,
      senderId: true,
      receiverId: true,
      isRead: true,
    },
  });

  // Build a map of otherUserId -> latest message (first seen = latest due to desc sort)
  const latestByPartner = new Map();
  for (const m of allMessages) {
    const partnerId = m.senderId === userId ? m.receiverId : m.senderId;
    if (!latestByPartner.has(partnerId)) {
      latestByPartner.set(partnerId, m);
    }
  }

  const partnerIds = [...latestByPartner.keys()];
  if (partnerIds.length === 0) return [];

  // 2. Single query: count unread messages grouped by sender
  const unreadCounts = await prisma.message.groupBy({
    by: ["senderId"],
    where: {
      receiverId: userId,
      isRead: false,
      senderId: { in: partnerIds },
    },
    _count: { id: true },
  });

  const unreadMap = new Map(
    unreadCounts.map((g) => [g.senderId, g._count.id])
  );

  // 3. Single query: fetch all partner user profiles at once
  const users = await prisma.user.findMany({
    where: { id: { in: partnerIds } },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      isOnline: true,
      lastSeen: true,
    },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  // Assemble the conversation list
  const conversations = partnerIds.map((partnerId) => ({
    user: userMap.get(partnerId) || null,
    lastMessage: latestByPartner.get(partnerId),
    unreadCount: unreadMap.get(partnerId) || 0,
  }));

  // Sort conversations by the most recent message
  conversations.sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.sentAt).getTime() : 0;
    const timeB = b.lastMessage ? new Date(b.lastMessage.sentAt).getTime() : 0;
    return timeB - timeA;
  });

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
