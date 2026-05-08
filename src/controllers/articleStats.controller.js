const statsService = require("../services/articleStats.service");

const getUserArticleStats = async (req, res) => {
  try {
    // req.user is populated by your authentication middleware
    const userId = req.user.id;

    const stats = await statsService.getAuthorArticleStats(userId);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching article stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch article statistics",
    });
  }
};

module.exports = {
  getUserArticleStats,
};