const prisma = require("../config/prisma");
const { createNotification } = require("../services/notification.service");

/**
 * @description Fetch all comments for a specific article
 */
const getComments = async (req, res) => {
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
      include: { author: { select: { id: true, displayName: true } } }
    });

    // --- DEBUG LOGS ---
    console.log("ATTEMPTING NOTIFICATION");
    console.log("Dest ID:", article.authorId);
    console.log("Source ID:", req.user.id);

    // 3. Trigger Notification
    const notifResult = await createNotification(req.app, {
      type: "COMMENT",
      destUserId: article.authorId, 
      sourceUserId: req.user.id,    
      sourceArticleId: article.id   
    });

    console.log("✅ NOTIFICATION SERVICE FINISHED. Result:", notifResult ? "Saved" : "Ignored/Failed");

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

    // 1. Fetch the article to get data for the notification
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { authorId: true, slug: true }
    });

    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found" });
    }

    // 2. Save the rating
    const userRating = await prisma.articleRating.upsert({
      where: {
        userId_articleId: { 
          userId: userId, 
          articleId: articleId 
        }
      },
      // If record exists, only update the score
      update: { 
        score: rating 
      },
      // If record is new, set everything
      create: { 
        userId: userId, 
        articleId: articleId, 
        score: rating 
      }
    });

    // 3. Trigger: New Rating Notification
    const notifResult = await createNotification(req.app, {
      type: "RATE",
      destUserId: article.authorId, 
      sourceUserId: req.user.id,    
      sourceArticleId: article.id   
    });

    res.status(200).json({ success: true, data: userRating });
  } catch (error) {
    console.error("Rating Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// CRITICAL: All functions must be in this export object
module.exports = {
  getComments,
  createComment,
  rateArticle
};