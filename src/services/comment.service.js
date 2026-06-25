const prisma = require("../config/prisma");
const { createNotification } = require("./notification.service");
const { updateCommentCount, updateRatingStats } = require("./articleStats.service"); // Removed updateInteractionsTable from here

//get all the comments
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

//add a comment
const addCommentToArticle = async (userId, articleId, content, parentId, appInstance) => {
  let catchError = null;
  let finalData = null;

  //THE DATABASE TRANSACTION
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

      //add the somment status into interactions table
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

//give a rating
const submitArticleRating = async (userId, articleId, rating, appInstance) => {
  let catchError = null;
  let finalData = null;

  //   THE DATABASE TRANSACTION
 try {
    finalData = await prisma.$transaction(async (tx) => {
      const article = await tx.article.findUnique({
        where: { id: articleId },
        select: { id: true, authorId: true } 
      });

      if (!article) throw new Error("Article not found");
      if (article.authorId === userId) throw new Error("You cannot rate your own article");

      //check if a rating already exists
      const existingRating = await tx.articleRating.findUnique({
        where: { userId_articleId: { userId, articleId } },
        select: { id: true } 
      });

      const isNew = !existingRating;

      //add the rating to articleRating table
      const userRating = await tx.articleRating.upsert({
        where: { userId_articleId: { userId, articleId } },
        update: { score: rating },
        create: { userId, articleId, score: rating }
      });

      // insert into interactions table
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

  // HANDLE ERRORS
  if (catchError) {
    console.error("Transaction failed:", catchError.message);
    throw new Error(catchError.message || "Failed to submit rating");
  }

  // External Functions (Runs only if there are no errors)
  try {
    //will create the notification if the rating is new 
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