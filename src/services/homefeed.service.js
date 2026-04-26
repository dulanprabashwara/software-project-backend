const prisma = require("../config/prisma");

const getPublishedMainFeed = async () => {
  return await prisma.article.findMany({
    where: { status: "PUBLISHED" }, 
    orderBy: { publishedAt: "desc" },
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