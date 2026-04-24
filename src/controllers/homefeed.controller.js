// backend/controllers/homefeed.controller.js
const prisma = require("../config/prisma");

// Endpoint 1: Main Feed Articles
exports.getMainFeed = async (req, res) => {
  try {
    const articles = await prisma.article.findMany({
      where: { status: "PUBLISHED" }, 
      orderBy: { createdAt: "desc" },
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

// Endpoint 2: Trending Articles
