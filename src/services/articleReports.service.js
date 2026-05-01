const prisma = require("../config/prisma"); // Adjust this path to wherever your Prisma client is exported

const saveReport = async (reporterId, articleId, reason, description) => {
  // We map the frontend's 'description' to the database's 'details' field
  const report = await prisma.reportedArticle.create({
    data: {
      reporterId: reporterId,
      articleId: articleId,
      reason: reason,
      details: description, 
    },
  });

  return report;
};

module.exports = {
  saveReport,
};