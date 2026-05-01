const trendingArticlesService = require("../services/trendingArticles.service");

const getTrendingTitles = async (req, res) => {
  try {
    const trending = await trendingArticlesService.fetchTrendingTitles();
    res.status(200).json(trending); 
  } catch (error) {
    console.error("TRENDING ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch trending titles" });
  }
};

const getTrendingArticles = async (req, res) => {
  try {
    const articles = await trendingArticlesService.fetchTrendingArticles();
    res.status(200).json(articles); 
  } catch (error) {
    console.error("MAIN FEED ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch trending articles" });
  }
};

module.exports = {
  getTrendingTitles,
  getTrendingArticles
};