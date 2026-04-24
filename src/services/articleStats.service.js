const prisma = require("../config/prisma");

/**
 * Updates the comment count for an article using Prisma's atomic increment.
 */
const updateCommentCount = async (articleId) => {
  try {
    const updatedArticle = await prisma.article.update({
      where: { id: articleId },
      data: {
        commentCount: { increment: 1 } // Safely adds 1 to the current count
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
    // 1. Ask Prisma to calculate the Average and the Count of all scores for this article
    const aggregations = await prisma.articleRating.aggregate({
      where: { articleId: articleId },
      _avg: { score: true },
      _count: { score: true }
    });

    // 2. Extract the numbers (fallback to 0 if there are no ratings somehow)
    const newAverage = aggregations._avg.score || 0;
    const newCount = aggregations._count.score || 0;

    // 3. Update the Article table with the freshly calculated stats
    const updatedArticle = await prisma.article.update({
      where: { id: articleId },
      data: {
        averageRating: newAverage,
        ratingCount: newCount
      }
    });

    return updatedArticle;
  } catch (error) {
    console.error("Failed to update rating stats:", error.message);
    throw error; // Throwing allows the controller to catch and handle it if needed
  }
};

module.exports = { 
  updateCommentCount, 
  updateRatingStats 
};