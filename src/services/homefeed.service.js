const prisma = require("../config/prisma");

const getPublishedMainFeed = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  return await prisma.article.findMany({
    where: { status: "PUBLISHED" }, 
    orderBy: { publishedAt: "desc" },
    take: limit, // Only fetch 10
    skip: skip,  // Skip previous pages
    include: {
      author: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
          isPremium: true
        },
      },
    },
  });
};

module.exports = {
  getPublishedMainFeed,
};