const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

/**
 * Toggle like on an article.
 */
const toggleLike = async (userId, articleId) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");

  const existingLike = await prisma.articleLike.findUnique({
    where: { userId_articleId: { userId, articleId } },
  });

  if (existingLike) {
    await prisma.articleLike.delete({ where: { id: existingLike.id } });
    await prisma.article.update({
      where: { id: articleId },
      data: { likeCount: { decrement: 1 } },
    });

    // Update author stats
    await prisma.userStats.upsert({
      where: { userId: article.authorId },
      update: { totalLikes: { decrement: 1 } },
      create: { userId: article.authorId },
    });

    return { liked: false, likeCount: article.likeCount - 1 };
  } else {
    await prisma.articleLike.create({ data: { userId, articleId } });
    await prisma.article.update({
      where: { id: articleId },
      data: { likeCount: { increment: 1 } },
    });

    await prisma.userStats.upsert({
      where: { userId: article.authorId },
      update: { totalLikes: { increment: 1 } },
      create: { userId: article.authorId, totalLikes: 1 },
    });

    return { liked: true, likeCount: article.likeCount + 1 };
  }
};

/**
 * Record a share of an article.
 */
const shareArticle = async (userId, articleId, platform = null) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");

  await prisma.articleShare.create({
    data: { userId, articleId, platform },
  });

  await prisma.article.update({
    where: { id: articleId },
    data: { shareCount: { increment: 1 } },
  });

  return { shareCount: article.shareCount + 1 };
};

/**
 * Save/unsave an article (bookmark).
 */
const toggleSaveArticle = async (userId, articleId) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");

  const existing = await prisma.savedArticle.findUnique({
    where: { userId_articleId: { userId, articleId } },
  });

  if (existing) {
    await prisma.savedArticle.delete({ where: { id: existing.id } });
    return { saved: false };
  } else {
    await prisma.savedArticle.create({ data: { userId, articleId } });
    return { saved: true };
  }
};

/**
 * Get user's saved articles (library).
 */
const getSavedArticles = async (userId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [saved, total] = await Promise.all([
    prisma.savedArticle.findMany({
      where: { userId },
      include: {
        article: {
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
        },
      },
      orderBy: { savedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.savedArticle.count({ where: { userId } }),
  ]);

  return {
    articles: saved.map((s) => ({ ...s.article, savedAt: s.savedAt })),
    total,
  };
};

/**
 * Get user's read history.
 */
const getReadHistory = async (userId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [history, total] = await Promise.all([
    prisma.readHistory.findMany({
      where: { userId },
      include: {
        article: {
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
        },
      },
      orderBy: { lastReadAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.readHistory.count({ where: { userId } }),
  ]);

  return {
    articles: history.map((h) => ({ ...h.article, lastReadAt: h.lastReadAt })),
    total,
  };
};

module.exports = {
  toggleLike,
  shareArticle,
  toggleSaveArticle,
  getSavedArticles,
  getReadHistory,
};
