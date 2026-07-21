const topUserArticlesService = require("../services/topUserArticles.service");

const getTopUserArticles = async (req, res) => {
  try {
    // Note: Adjust 'req.user.id' if your auth middleware stores the ID differently 
    // (e.g., req.user.uid or req.userId)
    const userId = req.user.id; 

    if (!userId) {
      return res.status(401).json({ error: "User ID not found in request" });
    }

    const articles = await topUserArticlesService.fetchTopUserArticles(userId);
    res.status(200).json(articles); 
  } catch (error) {
    console.error("TOP USER ARTICLES ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch top articles for user" });
  }
};

module.exports = {
  getTopUserArticles
};