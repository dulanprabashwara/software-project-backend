const prisma = require("../config/prisma");

const fetchUserInteractions = async (userId) => {
  const interactedRecords = await prisma.articleInteractions.findMany({
    where: { userId: userId },
    orderBy: { dateUpdated: 'desc' },
    include: {
      article: {
        include: {
          author: {
            select: {
               id: true, 
               displayName: true, 
               avatarUrl: true, 
               isPremium: true,
              username: true }
          },
          _count: {
            select: { comments: true }
          }
        }
      }
    }
  });

  return interactedRecords.map(record => ({
    ...record.article,
    commentStatus: record.commentStatus,
    rateStatus: record.rateStatus,
    interactedAt: record.dateUpdated 
  }));
};

module.exports = {
  fetchUserInteractions,
};