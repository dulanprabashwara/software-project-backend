const interactedArticlesService = require("../services/interactedArticles.service");

const getMyInteractedArticles = async (req, res) => {
  try {
    const userId = req.user.id;
    const articles = await interactedArticlesService.fetchUserInteractions(userId);

    res.status(200).json({ success: true, data: articles });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, message: "Failed to fetch interacted articles" });
  }
};

module.exports = {
  getMyInteractedArticles,
};