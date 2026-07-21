const prisma = require("../config/prisma");


 //Fetches articles read by a specific user (paginated).
const getUserReadHistory = async (userId, page = 1, limit = 10) => {
  //calculate how many records to skip
  const skip = (page - 1) * limit;

  return await prisma.readHistory.findMany({
    where: { userId },
    skip,
    take: limit,
    include: {
      article: {
        select: {
          id: true,
          title: true,
          coverImage: true,
          summary: true,
          publishedAt: true,
          commentCount:true,
          ratingCount:true,
          averageRating:true,
          status:true,
          isAiGenerated:true,
          author: {
            select: { 
                displayName: true,
                isPremium: true,
                username: true,
                avatarUrl: true,

                 
            }
          }
        }
      }
    },
    orderBy: { lastReadAt: "desc" },
  });
};


 // Upserts a read record.
 
const recordArticleRead = async (userId, articleId) => {
   return await prisma.$transaction([
    
    // Upsert the user's personal read history
    prisma.readHistory.upsert({
      where: {
        userId_articleId: { userId, articleId },
      },
      update: {
        lastReadAt: new Date(),
        readCount: { increment: 1 },
      },
      create: {
        userId,
        articleId,
      },
    }),

    // Increment the read count on the article itself
    prisma.article.update({
      where: {
        id: articleId,
      },
      data: {
        readCount: { increment: 1 },
      },
    }),
    
  ]);
};

module.exports = {
  getUserReadHistory,
  recordArticleRead,
};