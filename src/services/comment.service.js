const prisma = require("../config/prisma");
const { createNotification } = require("./notification.service");
const { updateCommentCount, updateRatingStats, updateInteractionsTable } = require("./articleStats.service");

const fetchArticleComments = async (articleId) => {
  return await prisma.comment.findMany({
    where: { articleId },
    include: {
      author: {
        select: { id: true, displayName: true, avatarUrl: true, role: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
};

const addCommentToArticle = async (userId, articleId, content, parentId, appInstance) => {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorId: true, slug: true, id: true }
  });

  if (!article) throw new Error("Article not found");

  const newComment = await prisma.comment.create({
    data: { content, articleId, authorId: userId, parentId: parentId || null },
    include: { 
      author: { select: { id: true, displayName: true } } 
    }
  });

  await createNotification(appInstance, {
    type: "COMMENT",
    destUserId: article.authorId, 
    sourceUserId: userId,    
    sourceArticleId: article.id   
  });

  await updateCommentCount(articleId);
  await updateInteractionsTable(userId, articleId, 'COMMENT');

  return newComment;
};

const submitArticleRating = async (userId, articleId, rating, appInstance) => {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, authorId: true } 
  });

  if (!article) throw new Error("Article not found");

  const existingRating = await prisma.articleRating.findUnique({
    where: { userId_articleId: { userId, articleId } }
  });

  let userRating;

  if (existingRating) {
    userRating = await prisma.articleRating.update({
      where: { userId_articleId: { userId, articleId } },
      data: { score: rating }
    });
  } else { 
    userRating = await prisma.articleRating.create({
      data: { userId, articleId, score: rating }
    });

    await createNotification(appInstance, {
      type: "RATE",
      destUserId: article.authorId, 
      sourceUserId: userId,    
      sourceArticleId: articleId 
    });
  }

  await updateRatingStats(articleId);
  await updateInteractionsTable(userId, articleId, 'RATE');

  return userRating;
};

module.exports = {
  fetchArticleComments,
  addCommentToArticle,
  submitArticleRating
};