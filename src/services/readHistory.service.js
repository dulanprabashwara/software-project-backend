const prisma = require("../config/prisma");


 //Fetches all articles read by a specific user.
 //Includes basic article info  
 
const getUserReadHistory = async (userId) => {
  return await prisma.readHistory.findMany({
    where: { userId },
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