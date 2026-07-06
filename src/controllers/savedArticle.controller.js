const savedArticleService = require("../services/savedArticle.service");

 //function to get already saved articles
const getMySavedArticles = async (req, res) => {
  try {
    const userId = req.user.id; // Extract from Auth middleware
    
    // Call the Service
    const articles = await savedArticleService.getUserSavedArticles(userId);

    res.status(200).json({ success: true, data: articles });
  } catch (error) {
    console.error("Fetch Saved Articles Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch saved articles." });
  }
};

//get saved raticles IDs 
const getMySavedList = async (req, res) => {
  try {
    const userId = req.user.id;  
    
    // Call the Service
    const articles = await savedArticleService.getSavedList(userId);

    res.status(200).json({ success: true, data: articles });
  } catch (error) {
    console.error("Fetch Saved Articles Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch saved List" });
  }
};

 
//add an article to saved
const saveArticle = async (req, res) => {
  try {
    const { articleId } = req.body;
    const userId = req.user.id;

    // Call the Service
    const savedArticle = await savedArticleService.createSavedArticle(userId, articleId);

    res.status(201).json({ success: true, data: savedArticle });
  } 
  
  catch (error) {
    // Handle the custom error thrown by our Service
    if (error.isDuplicate) {
      return res.status(200).json({ success: true, message: "Already saved" });
    }
    
    console.error("Save Article Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to save article." });
  }
};

//remove an article from saved
const unsaveArticle = async (req, res) => {
  try {
    const articleId = req.body.id || req.body.articleId;
    const userId = req.user.id;

    // Call the Service
    await savedArticleService.removeSavedArticle(userId, articleId);

    res.status(200).json({ success: true, message: "Article unsaved" });
  } catch (error) {
    // Handle the custom error thrown by our Service
    if (error.isMissing) {
      return res.status(200).json({ success: true, message: "Already unsaved" });
    }

    console.error("Unsave Article Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to unsave article." });
  }
};

module.exports = {
  getMySavedArticles,
  saveArticle,
  unsaveArticle,
  getMySavedList
};