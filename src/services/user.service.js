const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

/**
 * Get user profile by ID or username.
 */
const getUserProfile = async (identifier, currentUserId = null) => {
  const where =
    identifier.startsWith("clz") || identifier.length > 20
      ? { id: identifier }
      : { username: identifier };

  const user = await prisma.user.findFirst({
    where,
    select: {
      id: true,
      username: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
      isPremium: true,
      isOnline: true,
      lastSeen: true,
      createdAt: true,
      role: true,
      linkedInAccountId: true,
      wordpressAccountId: true,
      stats: true,
      _count: {
        select: {
          articles: { where: { status: "PUBLISHED" } },
          followers: true,
          following: true,
          sentMessages: true,
          receivedMessages: true,
        },
      },
      //check if current user follows this profile
      ...(currentUserId && {
        followers: {
          where: { followerId: currentUserId },
          select: { id: true },
        },
      }),
    },
  });

  if (!user) throw ApiError.notFound("User not found.");

  let isFollowing = false;
  if (currentUserId && currentUserId !== user.id) {
    // If the array has an item, the current user is following this profile
    isFollowing = user.followers && user.followers.length > 0;
  }

  // Calculate unread message count for profile display
  const unreadMessageCount = await prisma.message.count({
    where: {
      receiverId: user.id,
      isRead: false,
    },
  });

  // Remove loaded followers,sentMessages and receivedMessages arrays from the backend to ensures you don't leak internal database arrays to the frontend
  delete user.followers;
  delete user._count.sentMessages;
  delete user._count.receivedMessages;

  return { ...user, isFollowing, unreadMessageCount };
};

/**
 * Update user profile.
 */
const updateProfile = async (userId, data) => {
  const {
    displayName,
    bio,
    avatarUrl,
    linkedInAccountId,
    wordpressAccountId,
    username,
  } = data;

  // If updating username check if it's taken
  if (username) {
    const existing = await prisma.user.findFirst({
      where: { username, NOT: { id: userId } },
    });
    if (existing) throw ApiError.conflict("Username already taken.");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(displayName !== undefined && { displayName }),
      ...(bio !== undefined && { bio }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(linkedInAccountId !== undefined && { linkedInAccountId }),
      ...(wordpressAccountId !== undefined && { wordpressAccountId }),
      ...(username && { username }),
    },
    include: { stats: true },
  });

  return user;
};

/**
 * Search users by username or display name.
 */
const searchUsers = async (query, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: "insensitive" } },
          { displayName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        isPremium: true,
      },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({
      where: {
        OR: [
          { username: { contains: query, mode: "insensitive" } },
          { displayName: { contains: query, mode: "insensitive" } },
        ],
      },
    }),
  ]);

  return { users, total };
};

/**
 * Delete a user account and all associated data.
 * Most relations use onDelete: Cascade in the schema, but
 * Subscription and AuditLog do not have relationship with other tables so we clean them up manually
 */
const deleteAccount = async (userId, firebaseUid) => {
  const admin = require("../config/firebase");

  // 1. Delete non-cascading relations first
  await prisma.subscription.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { adminId: userId } });

  // 2. Delete the user row — all Cascade relations are cleaned up automatically
  await prisma.user.delete({ where: { id: userId } });

  // 3. Delete the Firebase Auth account
  try {
    await admin.auth().deleteUser(firebaseUid);
  } catch (err) {
    // If Firebase deletion fails the DB row is already gone.
    // Log but don't throw — the account is effectively deleted.
    console.error("Failed to delete Firebase auth account:", err.message);
  }
};

module.exports = { getUserProfile, updateProfile, searchUsers, deleteAccount };
