const prisma = require("../config/prisma");

/**
 * Fetches all articles read by a specific user.
 * Includes basic article info so the frontend can display titles/images.
 */
const getUserReadHistory = async (userId) => {
  return await prisma.readHistory.findMany({
    where: { userId },
    include: {
      article: {
        select: {
          id: true,
          title: true,
          coverImage: true,
          content: true,
          publishedAt: true,
          commentCount:true,
          ratingCount:true,
          averageRating:true,
          status:true,
          isAiGenerated:true,
          author: {
            select: { 
                displayName: true,
                isPremium: true,
                username: true

                 
            }
          }
        }
      }
    },
    orderBy: { lastReadAt: "desc" },
  });
};

/**
 * Upserts a read record. If the user reads the article again, 
 * it updates the timestamp and increments the count.
 */
const recordArticleRead = async (userId, articleId) => {
  return await prisma.readHistory.upsert({
    where: {
      userId_articleId: { userId, articleId },
    },
    update: {
      lastReadAt: new Date(),
      readCount: { increment: 1 },
    },
    create: {
      userId,
      articleId,
    },
  });
};

module.exports = {
  getUserReadHistory,
  recordArticleRead,
};