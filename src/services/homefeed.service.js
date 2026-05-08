const prisma = require("../config/prisma");

const getPublishedMainFeed = async (page = 1, limit = 5) => {
  const skip = (page - 1) * limit;

  return await prisma.article.findMany({
    where: { status: "PUBLISHED" }, 
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

// UPDATED: Now requires userId and filters by followed authors
const getFollowingFeed = async (userId, page = 1, limit = 5) => {
  const skip = (page - 1) * limit;

  return await prisma.article.findMany({
    where: { 
      status: "PUBLISHED",
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