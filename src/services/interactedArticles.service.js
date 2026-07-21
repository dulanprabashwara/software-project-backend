const prisma = require("../config/prisma");

const fetchUserInteractions = async (userId, page = 1, limit = 10) => {
  //calculate how many records to skip
  const skip = (page - 1) * limit;

  const interactedRecords = await prisma.articleInteractions.findMany({
    where: { userId: userId },
    orderBy: { dateUpdated: 'desc' },
    skip,
    take: limit,
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




const getInteractedList = async (userId) => {
 const interactedList = await prisma.articleInteractions.findMany({
    where: { userId: userId },
    orderBy: { dateUpdated: 'desc' },
    include: {
      article: {
        select: { 
          id: true,
            
          },
        },
      },
    },
  );

  // Format the data before sending it back
  return interactedList.map(record => ({
    ...record.article,
    savedAt: record.dateUpdated,
    commentStatus: record.commentStatus,
    rateStatus: record.rateStatus
  }));
};


module.exports = {
  fetchUserInteractions,
  getInteractedList
};