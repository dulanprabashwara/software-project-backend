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

    // Passing req.app down so the service can trigger the notification system
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

module.exports = {
  getComments,
  createComment,
  rateArticle
};