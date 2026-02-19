const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

/**
 * Toggle follow/unfollow a user.
 */
const toggleFollow = async (followerId, followingId) => {
  if (followerId === followingId) {
    throw ApiError.badRequest("You cannot follow yourself.");
  }

  // Check if the target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: followingId },
  });
  if (!targetUser) throw ApiError.notFound("User not found.");

  // Check for existing follow
  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId, followingId },
    },
  });

  if (existingFollow) {
    // Unfollow
    await prisma.follow.delete({
      where: { id: existingFollow.id },
    });

    // Update stats
    await Promise.all([
      prisma.userStats.upsert({
        where: { userId: followerId },
        update: { totalFollowing: { decrement: 1 } },
        create: { userId: followerId },
      }),
      prisma.userStats.upsert({
        where: { userId: followingId },
        update: { totalFollowers: { decrement: 1 } },
        create: { userId: followingId },
      }),
    ]);

    return { followed: false };
  } else {
    // Follow
    await prisma.follow.create({
      data: { followerId, followingId },
    });

    // Update stats
    await Promise.all([
      prisma.userStats.upsert({
        where: { userId: followerId },
        update: { totalFollowing: { increment: 1 } },
        create: { userId: followerId, totalFollowing: 1 },
      }),
      prisma.userStats.upsert({
        where: { userId: followingId },
        update: { totalFollowers: { increment: 1 } },
        create: { userId: followingId, totalFollowers: 1 },
      }),
    ]);

    return { followed: true };
  }
};

/**
 * Get a user's followers list.
 */
const getFollowers = async (userId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const [followers, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: userId },
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.follow.count({ where: { followingId: userId } }),
  ]);

  return {
    users: followers.map((f) => f.follower),
    total,
  };
};

/**
 * Get users that a user is following.
 */
const getFollowing = async (userId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const [following, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.follow.count({ where: { followerId: userId } }),
  ]);

  return {
    users: following.map((f) => f.following),
    total,
  };
};

/**
 * Get the feed of articles from users that the current user follows.
 */
const getFollowingFeed = async (userId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  // Get IDs of users that this user follows
  const followingRecords = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  const followingIds = followingRecords.map((f) => f.followingId);

  if (followingIds.length === 0) {
    return { articles: [], total: 0 };
  }

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where: {
        authorId: { in: followingIds },
        status: "PUBLISHED",
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        _count: { select: { comments: true, likes: true } },
      },
      orderBy: { publishedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.article.count({
      where: {
        authorId: { in: followingIds },
        status: "PUBLISHED",
      },
    }),
  ]);

  return { articles, total };
};

module.exports = { toggleFollow, getFollowers, getFollowing, getFollowingFeed };
