const prisma = require("../config/prisma");

const getTrendingTitles = async (req, res) => {
  try {
    const trending = await prisma.article.findMany({
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
    res.status(200).json(trending); // Returning just the array
  } catch (error) {
    console.error("TRENDING ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch trending" });
  }
};

const getTrendingArticles = async (req, res) => {
  try {
    const articles = await prisma.article.findMany({
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
    res.status(200).json(articles); // Returning just the array
  } catch (error) {
    console.error("MAIN FEED ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch main feed" });
  }
};

// Explicitly export at the bottom. 
// Make sure this is the ONLY export in the whole file!
module.exports = {
  getTrendingTitles,
  getTrendingArticles
};