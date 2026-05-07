const prisma = require("../config/prisma");

/**
 * Updates the comment count for an article using Prisma's atomic increment.
 */
const updateCommentCount = async (articleId) => {
  try {
      const commentcount = await prisma.Comment.aggregate({
      where: { articleId: articleId },
      _count: { articleId: true }
    });


    const updatedArticle = await prisma.article.update({
      where: { id: articleId },
      data: {
        commentCount:commentcount ._count.articleId
      }
    });
    
    return updatedArticle;
  } catch (error) {
    console.error("Failed to update comment count:", error.message);
    throw error;
  }
};

/**
 * Recalculates the total count and average score of an article's ratings,
 * then updates the article record.
 */
const updateRatingStats = async (articleId) => {
  try {
    // 1. Calculate the Average and the Count of all scores for this specific article
    const articleAggregations = await prisma.articleRating.aggregate({
      where: { articleId: articleId },
      _avg: { score: true },
      _count: { score: true }
    });

    const newArticleAverage = articleAggregations._avg.score || 0;
    const newArticleCount = articleAggregations._count.score || 0;

    // 2. Update the Article table with the freshly calculated stats
    // Prisma returns the updated record, which gives us the authorId we need next
    const updatedArticle = await prisma.article.update({
      where: { id: articleId },
      data: {
        averageRating: newArticleAverage,
        ratingCount: newArticleCount
      }
    });

    const authorId = updatedArticle.authorId;

    // 3. Calculate the new overall average rating for the author across ALL their articles
    const userAggregations = await prisma.articleRating.aggregate({
      where: {
        article: {
          authorId: authorId,
        },
      },
      _avg: { score: true },
    });

    const newUserAverage = userAggregations._avg.score || 0;

    // Update the UserStats table using upsert
    await prisma.userStats.upsert({
      where: { userId: authorId },
      update: {
        averageRating: newUserAverage,
      },
      create: {
        userId: authorId,
        averageRating: newUserAverage,
      },
    });

    return updatedArticle;
  } catch (error) {
    console.error("Failed to update rating stats:", error.message);
    throw error;
  }
};
 

module.exports = { 
  updateCommentCount, 
  updateRatingStats,
};