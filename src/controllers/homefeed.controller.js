//main home page feeds
const homefeedService = require("../services/homefeed.service");

//New articles feed
exports.getMainFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1; //which page 
    const limit = 5;  //5 articles at a time

    const articles = await homefeedService.getPublishedMainFeed(page, limit);
    res.status(200).json(articles); 
  } catch (error) {
    console.error("MAIN FEED ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch main feed" });
  }
};

//following feed
 exports.getFollowingFeed = async (req, res) => {
  try {
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