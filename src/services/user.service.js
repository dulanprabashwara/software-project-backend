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
        },
      },
      // Eagerly check if current user follows this profile (saves 1 DB roundtrip)
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
  
  // Remove the eager loaded array from the response object
  delete user.followers;

  return { ...user, isFollowing };
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

  // If updating username, check if it's taken
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

module.exports = { getUserProfile, updateProfile, searchUsers };
