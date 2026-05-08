const prisma = require("../config/prisma");

//get a users rating sfor a certain article
const getUserRating = async (userId, articleId) => {
  return await prisma.articleRating.findFirst({
    where: { userId, articleId },
    orderBy: { createdAt: 'desc' }
  });
};

module.exports = {
  getUserRating,
};