const prisma = require("../config/prisma");

const fetchTrendingTitles = async () => {
  return await prisma.article.findMany({
    // Note: Kept "DRAFT" here to match your original code, 
    // but double-check if you actually meant "PUBLISHED" for trending!
    where: { status: "DRAFT" },
    orderBy: { trendingScore: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      createdAt: true,
      author: {
        select: { displayName: true }
      }
    }
  });
};

const fetchTrendingArticles = async () => {
  return await prisma.article.findMany({
    where: { status: "PUBLISHED" }, 
    orderBy: { trendingScore: "desc" },
    include: {
      author: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  });
};

module.exports = {
  fetchTrendingTitles,
  fetchTrendingArticles
};