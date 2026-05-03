const homefeedService = require("../services/homefeed.service");

exports.getMainFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 5; 

    const articles = await homefeedService.getPublishedMainFeed(page, limit);
    res.status(200).json(articles); 
  } catch (error) {
    console.error("MAIN FEED ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch main feed" });
  }
};

// ADDED: Following Feed Controller
exports.getFollowingFeed = async (req, res) => {
  try {
    // Note: This assumes your auth middleware attaches the user to `req.user`
    const userId = req.user?.id; 
    
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized. Please log in." });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = 5; 

    const articles = await homefeedService.getFollowingFeed(userId, page, limit);
    res.status(200).json(articles); 
  } catch (error) {
    console.error("FOLLOWING FEED ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch following feed" });
  }
};