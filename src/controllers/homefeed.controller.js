const homefeedService = require("../services/homefeed.service");

exports.getMainFeed = async (req, res) => {
  try {
    const articles = await homefeedService.getPublishedMainFeed();
    res.status(200).json(articles); 
  } catch (error) {
    console.error("MAIN FEED ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch main feed" });
  }
};