//get article details for the reading page
const articleReadService = require("../services/articleRead.service");

exports.getArticleById = async (req, res) => {
  const { id } = req.query; 

  try {
    if (!id) {
      return res.status(400).json({ error: "Article ID is required" });
    }

    const article = await articleReadService.getFullArticleDetails(id);

    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }

    res.status(200).json(article);
  } catch (error) {
    console.error("ARTICLE READ ERROR:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};