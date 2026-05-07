const prisma = require("../config/prisma");

const getUserRating = async (userId, articleId) => {
  return await prisma.articleRating.findFirst({
    where: { userId, articleId },
    orderBy: { createdAt: 'desc' }
  });
};

module.exports = {
  getUserRating,
};