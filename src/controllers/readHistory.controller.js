const readHistoryService = require("../services/readHistory.service");

 
 // Returns the list of articles the user has read.
 
const getReadHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const history = await readHistoryService.getUserReadHistory(userId);

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