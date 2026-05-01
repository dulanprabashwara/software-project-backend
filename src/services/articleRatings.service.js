const prisma = require("../config/prisma");

const getUserRatings = async (userId) => {
  return await prisma.articleRating.findMany({
    where: { userId: userId },
    orderBy: { createdAt: 'desc' }
  });
};

module.exports = {
  getUserRatings,
};