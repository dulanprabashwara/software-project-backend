//get popular topics (from tags)
const articleService = require("../services/popularTopics.service");

const getTrendingTopics = async (req, res) => {
  try {
    const limit = req.query.limit || 10; //how many topics
    const topics = await articleService.getPopularTags(limit);

    res.status(200).json({
      success: true,
      data: topics,
    });
  } catch (error) {
    console.error("Error fetching trending topics:", error);
    res.status(500).json({
      success: false,
      message: "Could not fetch trending topics",
    });
  }
};

module.exports = {
  getTrendingTopics,
};