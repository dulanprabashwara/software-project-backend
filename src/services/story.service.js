const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

/**
 * Create a new story (expires after 24 hours).
 */
const createStory = async (authorId, { mediaUrl, caption }) => {
  if (!mediaUrl)
    throw ApiError.badRequest("Media URL is required for a story.");

  const story = await prisma.story.create({
    data: {
      mediaUrl,
      caption: caption || null,
      authorId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
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
    },
  });

  return story;
};

/**
 * Get stories from users the current user follows (active / non-expired).
 */
const getFollowingStories = async (userId) => {
  // Get IDs of users the current user follows
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  const followingIds = following.map((f) => f.followingId);

  // Include the user's own stories
  followingIds.push(userId);

  const stories = await prisma.story.findMany({
    where: {
      authorId: { in: followingIds },
      expiresAt: { gt: new Date() }, // Only non-expired stories
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
    },
    orderBy: { createdAt: "desc" },
  });

  // Group stories by author
  const grouped = {};
  for (const story of stories) {
    const authorId = story.author.id;
    if (!grouped[authorId]) {
      grouped[authorId] = {
        author: story.author,
        stories: [],
      };
    }
    grouped[authorId].stories.push(story);
  }

  return Object.values(grouped);
};

/**
 * Delete a story (only by author).
 */
const deleteStory = async (storyId, userId) => {
  const story = await prisma.story.findUnique({ where: { id: storyId } });

  if (!story) throw ApiError.notFound("Story not found.");
  if (story.authorId !== userId)
    throw ApiError.forbidden("You can only delete your own stories.");

  await prisma.story.delete({ where: { id: storyId } });
  return { deleted: true };
};

/**
 * Cleanup expired stories (can be run as a cron job).
 */
const cleanupExpiredStories = async () => {
  const result = await prisma.story.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { deletedCount: result.count };
};

module.exports = {
  createStory,
  getFollowingStories,
  deleteStory,
  cleanupExpiredStories,
};
