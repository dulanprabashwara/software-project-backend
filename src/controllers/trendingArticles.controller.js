const prisma = require("../config/prisma");

const getTrending = async (req, res) => {
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

// Explicitly export at the bottom. 
// Make sure this is the ONLY export in the whole file!
module.exports = {
  getTrending
};