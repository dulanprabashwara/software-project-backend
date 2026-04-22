const prisma = require("../config/prisma");

/**
 * @description Fetch all saved articles for the logged-in user
 * Route: GET /api/saved-articles
 */
const getMySavedArticles = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch the junction table records
    const savedRecords = await prisma.savedArticle.findMany({
      where: { userId: userId },
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

/**
 * @description Save an article for the user
 * Route: POST /api/saved-articles
 */
const saveArticle = async (req, res) => {
  try {
    const { articleId } = req.body;
    const userId = req.user.id;

    const savedArticle = await prisma.savedArticle.create({
      data: { userId, articleId },
    });

    res.status(201).json({ success: true, data: savedArticle });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(200).json({ success: true, message: "Already saved" });
    }
    console.error("Save Article Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @description Remove a saved article
 * Route: DELETE /api/saved-articles
 */
const unsaveArticle = async (req, res) => {
  try {
    const articleId = req.body.id || req.body.articleId;
    const userId = req.user.id;

    await prisma.savedArticle.delete({
      where: {
        userId_articleId: { userId, articleId },
      },
    });

    res.status(200).json({ success: true, message: "Article unsaved" });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(200).json({ success: true, message: "Already unsaved" });
    }
    console.error("Unsave Article Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMySavedArticles,
  saveArticle,
  unsaveArticle,
};