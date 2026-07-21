const readHistoryService = require("../services/readHistory.service");

 
 // Returns the list of articles the user has read (paginated).
const getReadHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    //read page from query, default to 1
    const page = parseInt(req.query.page) || 1;
    const limit = 10;

    const history = await readHistoryService.getUserReadHistory(userId, page, limit);

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error("Read History Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve read history",
    });
  }
};

 
 //to add an adrticle to users history
const markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { articleId } = req.body;

    if (!articleId) {
      return res.status(400).json({ success: false, message: "Article ID required" });
    }

    await readHistoryService.recordArticleRead(userId, articleId);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getReadHistory,
  markAsRead,
};