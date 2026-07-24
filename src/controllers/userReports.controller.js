const reportService = require("../services/articleReports.service");

const reportUser = async (req, res) => {
  try {
    const userId = req.user.id; // The reporter
    const { reportedUserId, reason, description, articleId } = req.body;

    if (!reportedUserId || !reason || !articleId) {
      return res.status(400).json({ 
        success: false, 
        message: "Reported user ID, article ID, and reason are required" 
      });
    }

    // Embed the reported user id in the details to avoid Prisma constraint errors,
    // since ReportedArticle strictly requires an articleId.
    const enrichedDescription = `Reported User ID: ${reportedUserId} \n\nDetails: ${description || "No additional details"}`;

    const newReport = await reportService.saveReport(userId, articleId, reason, enrichedDescription);

    res.status(201).json({ success: true, data: newReport });
  } catch (error) {
    console.error("Error creating user report:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  reportUser,
};
