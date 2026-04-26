const prisma = require("../config/prisma");

const getMyInteractedArticles = async (req, res) => {
  try {
    const userId = req.user.id;

    const interactedRecords = await prisma.articleInteractions.findMany({
      where: { userId: userId },
      orderBy: { dateUpdated: 'desc' },
      include: {
        article: {
          include: {
            author: {
              select: { id: true, displayName: true, avatarUrl: true, isPremium: true }
            },
            _count: {
              select: { comments: true }
            }
          }
        }
      }
    });

    const articles = interactedRecords.map(record => ({
      ...record.article,
      commentStatus: record.commentStatus,
      rateStatus: record.rateStatus,
      interactedAt: record.dateUpdated 
    }));

    res.status(200).json({ success: true, data: articles });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMyInteractedArticles,
};