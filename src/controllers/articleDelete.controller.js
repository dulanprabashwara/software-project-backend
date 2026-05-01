const articleService = require("../services/article.service");

const deleteArticle = async (req, res) => {
  try {
    const userId = req.user.id; // Comes from your authenticate middleware
    const { id: articleId } = req.params; // Extracts ID from the URL (e.g., /api/articles/123)

    if (!articleId) {
      return res.status(400).json({ success: false, message: "Article ID is required" });
    }

    // Pass data to service
    await articleService.deleteArticle(articleId, userId);

    res.status(200).json({ success: true, message: "Article deleted successfully." });
  } catch (error) {
    console.error("Error deleting article:", error);
    
    // Send appropriate status code based on error
    if (error.message.includes("Unauthorized")) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  deleteArticle,
};