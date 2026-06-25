//get articles a user has interacted with (comment, rate)
const interactedArticlesService = require("../services/interactedArticles.service");

//get ll article details
const getMyInteractedArticles = async (req, res) => {
  try {
    const userId = req.user.id;
    const articles = await interactedArticlesService.fetchUserInteractions(userId);

    res.status(200).json({ success: true, data: articles });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, message: "Failed to fetch interacted articles" });
  }
};

//get a list of article IDs
const getMyInteractedList = async (req, res) => {
  try {
    const userId = req.user.id; // Extract from Auth middleware
    
    // Call the Service
    const articles = await interactedArticlesService.getInteractedList(userId);

    res.status(200).json({ success: true, data: articles });
  } catch (error) {
    console.error("Fetch Saved Articles Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch saved List" });
  }
};

module.exports = {
  getMyInteractedArticles,
  getMyInteractedList
};