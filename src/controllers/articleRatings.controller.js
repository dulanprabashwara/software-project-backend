const articleRatingsService = require("../services/articleRatings.service");

const getMyArticleRatings = async (req, res) => {
  try {
    const userId = req.user.id;
    const{articleId}= req.query;
    const ratings = await articleRatingsService.getUserRating(userId,articleId);

    res.status(200).json({ success: true, data: ratings });
  } catch (error) {
    console.error("Fetch Article Ratings Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch article ratings" });
  }
};

module.exports = {
  getMyArticleRatings,
};