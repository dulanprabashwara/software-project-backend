const prisma = require("../config/prisma");

/**
 * @description Fetch all saved articles for the logged-in user
 * Route: GET /api/saved-articles
 */
const getPublishdArticles = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch the junction table records
    const publishedList = await prisma.Article.findMany({
      where: { 
        userId: userId,
        status: "PUBLISHED" },
      orderBy: { savedAt: 'desc' }, // Newest saves first
      include: {
        article: {
          include: {
            author: {
              select: { id: true, displayName: true, avatarUrl: true, isPremium: true }
            },
            _count: {
              select: { comments: true }
            }
          }
        }
      }
    });

    // Extract the nested 'article' objects into a flat array for the frontend
    const articles = savedRecords.map(record => ({
      ...record.article,
      savedAt: record.savedAt // Optional: Keep track of exactly when they saved it
    }));

    res.status(200).json({ success: true, data: articles });
  } catch (error) {
    console.error("Fetch Saved Articles Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

 
module.exports = {
   
};