const prisma = require("../config/prisma");
const { createNotification } = require("./notification.service");
const { updateCommentCount, updateRatingStats } = require("./articleStats.service"); // Removed updateInteractionsTable from here

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
  let catchError = null;
  let finalData = null;

  // 1. THE DATABASE TRANSACTION
  try {
    finalData = await prisma.$transaction(async (tx) => {
      const article = await tx.article.findUnique({
        where: { id: articleId },
        select: { authorId: true, slug: true, id: true }
      });

      if (!article) throw new Error("Article not found");

      const newComment = await tx.comment.create({
        data: { content, articleId, authorId: userId, parentId: parentId || null },
        include: { author: { select: { id: true, displayName: true } } }
      });

      // Inserted your upsert logic directly into the transaction using 'tx'
      await tx.articleInteractions.upsert({
        where: { userId_articleId: { userId, articleId } },
        update: { commentStatus: true },
        create: { userId, articleId, commentStatus: true }
      });

      return { newComment, article }; 
    });
  } catch (error) {
    catchError = error;
  }

  // 2. HANDLE ERRORS
  if (catchError) {
    console.error("Transaction failed:", catchError.message);
    throw new Error(catchError.message || "Failed to post comment");
  }

  // 3. EXTERNAL FUNCTIONS (Runs only if there are no errors)
  try {
    await createNotification(appInstance, {
      type: "COMMENT",
      destUserId: finalData.article.authorId, 
      sourceUserId: userId,    
      sourceArticleId: finalData.article.id   
    });

    await updateCommentCount(articleId);
  } catch (sideEffectError) {
    console.error("Comment saved, but external updates failed:", sideEffectError);
  }

  return finalData.newComment;
};

const submitArticleRating = async (userId, articleId, rating, appInstance) => {
  let catchError = null;
  let finalData = null;

  // 1. THE DATABASE TRANSACTION
  try {
    finalData = await prisma.$transaction(async (tx) => {
      const article = await tx.article.findUnique({
        where: { id: articleId },
        select: { id: true, authorId: true } 
      });

      if (!article) throw new Error("Article not found");

      const existingRating = await tx.articleRating.findUnique({
        where: { userId_articleId: { userId, articleId } }
      });

      let userRating;
      let isNew = false; 

      if (existingRating) {
        userRating = await tx.articleRating.update({
          where: { userId_articleId: { userId, articleId } },
          data: { score: rating }
        });
      } else { 
        userRating = await tx.articleRating.create({
          data: { userId, articleId, score: rating }
        });
        isNew = true;
      }

      // Inserted your upsert logic directly into the transaction using 'tx'
      await tx.articleInteractions.upsert({
        where: { userId_articleId: { userId, articleId } },
        update: { rateStatus: true },
        create: { userId, articleId, rateStatus: true }
      });

      return { userRating, article, isNew };
    });
  } catch (error) {
    catchError = error;
  }

  // 2. HANDLE ERRORS
  if (catchError) {
    console.error("Transaction failed:", catchError.message);
    throw new Error(catchError.message || "Failed to submit rating");
  }

  // 3. EXTERNAL FUNCTIONS (Runs only if there are no errors)
  try {
    if (finalData.isNew) {
      await createNotification(appInstance, {
        type: "RATE",
        destUserId: finalData.article.authorId, 
        sourceUserId: userId,    
        sourceArticleId: articleId 
      });
    }

    await updateRatingStats(articleId);
  } catch (sideEffectError) {
    console.error("Rating saved, but external updates failed:", sideEffectError);
  }

  return finalData.userRating;
};

module.exports = {
  fetchArticleComments,
  addCommentToArticle,
  submitArticleRating
};