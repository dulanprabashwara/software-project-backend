const prisma = require("../config/prisma");
const { createNotification } = require("./notification.service");
const { updateCommentCount, updateRatingStats } = require("./articleStats.service");

// get all the comments
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

// add a comment
const addCommentToArticle = async (userId, articleId, content, parentId, appInstance) => {
  let catchError = null;
  let finalData = null;

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

  if (catchError) throw new Error(catchError.message || "Failed to post comment");

  try {
    await createNotification(appInstance, {
      type: "COMMENT",
      destUserId: finalData.article.authorId, 
      sourceUserId: userId,    
      sourceArticleId: finalData.article.id   
    });

    await updateCommentCount(articleId);
  } catch (sideEffectError) {
    console.error("External updates failed:", sideEffectError);
  }

  return finalData.newComment;
};

// give a rating
const submitArticleRating = async (userId, articleId, rating, appInstance) => {
  let catchError = null;
  let finalData = null;

  try {
    finalData = await prisma.$transaction(async (tx) => {
      const article = await tx.article.findUnique({
        where: { id: articleId },
        select: { id: true, authorId: true } 
      });

      if (!article) throw new Error("Article not found");
      if (article.authorId === userId) throw new Error("You cannot rate your own article");

      const existingRating = await tx.articleRating.findUnique({
        where: { userId_articleId: { userId, articleId } },
        select: { id: true } 
      });

      const userRating = await tx.articleRating.upsert({
        where: { userId_articleId: { userId, articleId } },
        update: { score: rating },
        create: { userId, articleId, score: rating }
      });

      await tx.articleInteractions.upsert({
        where: { userId_articleId: { userId, articleId } },
        update: { rateStatus: true },
        create: { userId, articleId, rateStatus: true }
      });

      return { userRating, article, isNew: !existingRating };
    });
  } catch (error) {
    catchError = error;
  }

  if (catchError) throw new Error(catchError.message || "Failed to submit rating");

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
    console.error("External updates failed:", sideEffectError);
  }

  return finalData.userRating;
};

// SIMPLIFIED: Delete comment and lower count
const deleteComment = async (commentId, userId, userRole) => {
  // 1. Find the comment and the author of the article it belongs to
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { article: { select: { authorId: true } } }
  });

  if (!comment) throw new Error("Comment not found");

  // 2. Check authorization: Must be the Article Owner or an ADMIN
  if (comment.article.authorId !== userId && userRole !== 'ADMIN') {
    throw new Error("Unauthorized to delete this comment");
  }

  // 3. Delete the comment
  await prisma.comment.delete({
    where: { id: commentId }
  });

  // 4. Update (lower) the article's comment count
  try {
    await updateCommentCount(comment.articleId);
  } catch (error) {
    console.error("Failed to update comment count after deletion:", error);
  }

  return { success: true };
};

module.exports = {
  fetchArticleComments,
  addCommentToArticle,
  submitArticleRating,
  deleteComment
};