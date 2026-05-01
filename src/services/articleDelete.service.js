const prisma = require("../config/prisma"); 

const deleteArticle = async (articleId, userId) => {
  // 1. Find the article to verify ownership
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorId: true }
  });

  if (!article) {
    throw new Error("Article not found.");
  }

  // 2. Security Check: Only the author can delete their own article
  if (article.authorId !== userId) {
    throw new Error("Unauthorized: You do not have permission to delete this article.");
  }

  // 3. Delete the article (Prisma Cascade will handle comments, saves, etc.)
  const deletedArticle = await prisma.article.delete({
    where: { id: articleId },
  });

  return deletedArticle;
};

module.exports = {
  deleteArticleById,
};