const prisma = require("../config/prisma");

/**
 * @description Fetch all article ratings submitted by the currently logged-in user
 */
const getMyArticleRatings = async (req, res) => {
  try {
    // req.user.id comes from your authentication middleware
    const userId = req.user.id;

    const ratings = await prisma.articleRating.findMany({
      where: { 
        userId: userId 
      },
      orderBy: { 
        createdAt: 'desc' 
      }
    });

    res.status(200).json({ success: true, data: ratings });
  } catch (error) {
    console.error("Fetch Article Ratings Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMyArticleRatings,
};