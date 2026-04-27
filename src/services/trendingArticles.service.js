const prisma = require("../config/prisma");

const fetchTrendingTitles = async () => {
    const limit = 5;
  return await prisma.article.findMany({
    // Note: Kept "DRAFT" here to match your original code, 
    // but double-check if you actually meant "PUBLISHED" for trending!
    where: { status: "DRAFT" },
    orderBy: { trendingScore: 'desc' },
    take: limit,
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
const limit = 10;
  
return await prisma.article.findMany({
    where: { status: "PUBLISHED" }, 
    orderBy: { trendingScore: "desc" },
    take: limit,
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