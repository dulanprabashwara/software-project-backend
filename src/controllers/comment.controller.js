const commentService = require("../services/comment.service");

const getComments = async (req, res) => {
  try {
    const { articleId } = req.params;
    const comments = await commentService.fetchArticleComments(articleId);
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch comments" });
  }
};

const createComment = async (req, res) => {
  try {
    const { articleId, content, parentId } = req.body;
    const authorId = req.user.id; 

    const newComment = await commentService.addCommentToArticle(authorId, articleId, content, parentId, req.app);

    res.status(201).json(newComment);
  } catch (error) {
    console.error("CRASH IN CONTROLLER:", error);
    if (error.message === "Article not found") {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "Failed to create comment" });
  }
};

const rateArticle = async (req, res) => {
  try {
    const { articleId } = req.params;
    const { rating } = req.body;
    const userId = req.user.id;

    const userRating = await commentService.submitArticleRating(userId, articleId, rating, req.app);

    res.status(200).json({ success: true, data: userRating });
  } catch (error) {
    console.error("Rating Error:", error.message);
    if (error.message === "Article not found") {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: "Failed to rate article" });
  }
};

const deleteComment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role; 

    await commentService.deleteComment(id, userId, userRole);
    
    res.status(200).json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Delete Comment Error:", error.message);
    
    if (error.message === "Unauthorized to delete this comment") {
      return res.status(403).json({ success: false, message: error.message });
    }
    
    res.status(500).json({ success: false, message: "Failed to delete comment" });
  }
};

module.exports = {
  getComments,
  createComment,
  rateArticle,
  deleteComment
};