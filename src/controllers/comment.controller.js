const prisma = require("../config/prisma");

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
    
    // req.user is populated by your auth middleware
    const authorId = req.user.id; 

    const newComment = await prisma.comment.create({
      data: {
        content,
        articleId,
        authorId,
        parentId: parentId || null,
      },
      include: {
        author: {
          select: { id: true, displayName: true }
        }
      }
    });

    res.status(201).json(newComment);
  } catch (error) {
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