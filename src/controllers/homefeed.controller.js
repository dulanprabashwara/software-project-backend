const homefeedService = require("../services/homefeed.service");

exports.getMainFeed = async (req, res) => {
  try {
    // Read the page from the URL query (e.g., ?page=2), default to 1
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 10; 

    const articles = await homefeedService.getPublishedMainFeed(page, limit);
    res.status(200).json(articles); 
  } catch (error) {
    console.error("MAIN FEED ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch main feed" });
  }
};