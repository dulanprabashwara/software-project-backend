const prisma = require("../config/prisma");
const { createNotification } = require("../services/notification.service");
// Import the new markUserInteraction function
const { updateCommentCount, updateRatingStats, updateInteractionsTable } = require("../services/articleStats.service");

/**
 * @description Fetch all comments for a specific article
 */
const getComments = async (req, res) => {
  // ... (No changes needed here) ...
  try {
    const { articleId } = req.params;
    const comments = await prisma.comment.findMany({
      where: { articleId },
      include: {
        author: {
          select: { id: true, displayName: true, avatarUrl: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @description Create a new comment or reply
 */
const createComment = async (req, res) => {
  try {
    const { articleId, content, parentId } = req.body;
    const authorId = req.user.id; 

    // 1. Fetch the article
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { authorId: true, slug: true, id: true }
    });

    if (!article) return res.status(404).json({ success: false, message: "Article not found" });

    // 2. Create the comment
    const newComment = await prisma.comment.create({
      data: { content, articleId, authorId, parentId: parentId || null },
      include: { 
        author: { 
          select: { id: true, displayName: true } 
        } 
      }
    });

    // 3. Trigger Notification
    const notifResult = await createNotification(req.app, {
      type: "COMMENT",
      destUserId: article.authorId, 
      sourceUserId: req.user.id,    
      sourceArticleId: article.id   
    });

    // 4. Update Stats & Interactions
    await updateCommentCount(articleId);
    await updateInteractionsTable(req.user.id, articleId, 'COMMENT');

    res.status(201).json(newComment);
  } catch (error) {
    console.error("CRASH IN CONTROLLER:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @description Rate an article (1-5)
 */
const rateArticle = async (req, res) => {
  try {
    const { articleId } = req.params;
    const { rating } = req.body;
    const userId = req.user.id;

    // 1. Fetch the article to get the authorId
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, authorId: true } 
    });

    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found" });
    }

    // 2. Check if the user has ALREADY rated this article
    const existingRating = await prisma.articleRating.findUnique({
      where: {
        userId_articleId: { userId, articleId }
      }
    });

    let userRating;

    if (existingRating) {
      // --- UPDATE SCENARIO ---
      userRating = await prisma.articleRating.update({
        where: { userId_articleId: { userId, articleId } },
        data: { score: rating }
      });
      
    } else { 
      // Save the new rating
      userRating = await prisma.articleRating.create({
        data: { userId, articleId, score: rating }
      });

      // trigger the notification since it's their first time rating it
      await createNotification(req.app, {
        type: "RATE",
        destUserId: article.authorId, 
        sourceUserId: userId,    
        sourceArticleId: articleId 
      });
    }

    // 3. Update Stats & Interactions
    await updateRatingStats(articleId);
    await updateInteractionsTable(userId, articleId, 'RATE');

    res.status(200).json({ success: true, data: userRating });
  } catch (error) {
    console.error("Rating Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getComments,
  createComment,
  rateArticle
};