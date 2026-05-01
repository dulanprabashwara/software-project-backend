const prisma = require("../config/prisma");

const getFullArticleDetails = async (id) => {
  return await prisma.article.findUnique({
    where: { id: id },
    include: {
      author: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
          bio: true
        }
      },
      _count: {
        select: { comments: true }
      }
    }
  });
};

module.exports = {
  getFullArticleDetails,
};