//for filing reports 
const reportService = require("../services/articleReports.service");

const createReport = async (req, res) => {
  try {
    const userId = req.user.id; // Comes from your authenticate middleware
    const { articleId, reason, description } = req.body;

    if (!articleId || !reason) {
      return res.status(400).json({ 
        success: false, 
        message: "Article ID and reason are required" 
      });
    }

    // Pass the extracted data to the service layer
    const newReport = await reportService.saveReport(userId, articleId, reason, description);

    res.status(201).json({ success: true, data: newReport });
  } catch (error) {
    console.error("Error creating report:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createReport,
};