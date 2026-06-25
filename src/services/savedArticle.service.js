const prisma = require("../config/prisma");

// Fetch and format saved articles for a user
const getUserSavedArticles = async (userId, page = 1, limit = 10) => {
  //calculate how many records to skip
  const skip = (page - 1) * limit;

 const savedRecords = await prisma.savedArticle.findMany({
    where: { userId: userId },
    orderBy: { savedAt: 'desc' },
    skip,
    take: limit,
    include: {
      article: {
           include:{

           
          author: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
              isPremium: true,
              username:true
            },
          },
           
      }
      },
    },
  });

  // Format the data before sending it back
  return savedRecords.map(record => ({
    ...record.article,
    savedAt: record.savedAt
  }));
};

//get only a list of IDs of saved articles
const getSavedList = async (userId) => {
 const savedList = await prisma.savedArticle.findMany({
    where: { userId: userId },
    orderBy: { savedAt: 'desc' },
    include: {
      article: {
        select: {  
          id: true,
             
           
        },
      },
    },
  });

  // Format the data before sending it  
  return savedList.map(record => ({
    ...record.article,
    savedAt: record.savedAt
  }));
};


 //Save an article  
 const createSavedArticle = async (userId, articleId) => {
  try {
    const savedArticle = await prisma.savedArticle.create({
      data: { userId, articleId },
    });
    return savedArticle;
  } catch (error) {
    // We catch the Prisma-specific error here and translate it into a readable error
    if (error.code === 'P2002') {
      const customError = new Error("Already saved");
      customError.isDuplicate = true; // Add a flag for the controller to read
      throw customError;
    }
    throw error;
  }
};


//Remove a saved article  

const removeSavedArticle = async (userId, articleId) => {
  try {
    await prisma.savedArticle.delete({
      where: {
        userId_articleId: { userId, articleId },
      },
    });
    return true;
  } catch (error) {
    if (error.code === 'P2025') {
      const customError = new Error("Already unsaved");
      customError.isMissing = true;
      throw customError;
    }
    throw error;
  }
};

module.exports = {
  getUserSavedArticles,
  createSavedArticle,
  removeSavedArticle,
  getSavedList
};