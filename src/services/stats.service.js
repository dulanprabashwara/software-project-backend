const prisma = require("../config/prisma");

/**
 * Get user statistics.
 */
const getUserStats = async (userId) => {
  let stats = await prisma.userStats.findUnique({
    where: { userId },
  });

  if (!stats) {
    // Create stats record if it doesn't exist
    stats = await prisma.userStats.create({
      data: { userId },
    });
  }

  return stats;
};

/**
 * Recalculate user stats from actual data (for consistency).
 * Useful as a periodic job or on-demand recalculation.
 */
const recalculateUserStats = async (userId) => {
  const [articleCount, totalFollowers, totalFollowing, totalReads, totalLikes] =
    await Promise.all([
      prisma.article.count({
        where: { authorId: userId, status: "PUBLISHED" },
      }),
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
      prisma.article.aggregate({
        where: { authorId: userId },
        _sum: { readCount: true },
      }),
      prisma.article.aggregate({
        where: { authorId: userId },
        _sum: { likeCount: true },
      }),
    ]);

  const stats = await prisma.userStats.upsert({
    where: { userId },
    update: {
      articleCount,
      totalFollowers,
      totalFollowing,
      totalReads: totalReads._sum.readCount || 0,
      totalLikes: totalLikes._sum.likeCount || 0,
    },
    create: {
      userId,
      articleCount,
      totalFollowers,
      totalFollowing,
      totalReads: totalReads._sum.readCount || 0,
      totalLikes: totalLikes._sum.likeCount || 0,
    },
  });

  return stats;
};

/**
 * Get top performing articles for a user.
 */
const getTopPerformingArticles = async (userId, limit = 5) => {
  const articles = await prisma.article.findMany({
    where: { authorId: userId, status: "PUBLISHED" },
    orderBy: [{ readCount: "desc" }, { likeCount: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      slug: true,
      readCount: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      publishedAt: true,
    },
  });

  return articles;
};

/**
 * Get an overview of article performance over time.
 */
const getArticleAnalytics = async (userId) => {
  const articles = await prisma.article.findMany({
    where: { authorId: userId, status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      readCount: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      publishedAt: true,
    },
    orderBy: { publishedAt: "desc" },
  });

  const totals = articles.reduce(
    (acc, article) => ({
      totalReads: acc.totalReads + article.readCount,
      totalLikes: acc.totalLikes + article.likeCount,
      totalComments: acc.totalComments + article.commentCount,
      totalShares: acc.totalShares + article.shareCount,
    }),
    { totalReads: 0, totalLikes: 0, totalComments: 0, totalShares: 0 },
  );

  return { articles, totals };
};

module.exports = {
  getUserStats,
  recalculateUserStats,
  getTopPerformingArticles,
  getArticleAnalytics,
};
