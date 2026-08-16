const prisma = require("../config/prisma");

//get the feed of new articles (5 at ta time)
const getPublishedMainFeed = async (page = 1, limit = 3) => {
  const skip = (page - 1) * limit; //how many records to skip

  return await prisma.article.findMany({
    where: { status:{
                  in:["PUBLISHED","REPUBLISHED"]

    }}, 
    orderBy: { publishedAt: "desc" },
    take: limit, 
    skip: skip,  
    include: {
      author: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
          isPremium: true,
          id: true,
        },
      },
    },
  });
};

// get a users follwoing authors feed
const getFollowingFeed = async (userId, page = 1, limit = 5) => {
  const skip = (page - 1) * limit; //for paginaton

  return await prisma.article.findMany({
    where: { 
      status:{
                  in:["PUBLISHED","REPUBLISHED"]

    },
      author: {
        followers: {
          some: {
            followerId: userId // Only articles where the current user is a follower
          }
        }
      }
    }, 
    orderBy: { publishedAt: "desc" },
    take: limit, 
    skip: skip,  
    include: {
      author: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
          isPremium: true
        },
      },
    },
  });
};

module.exports = {
  getPublishedMainFeed,
  getFollowingFeed // Make sure to export it
};