const { Router } = require("express");
const articleController = require("../controllers/article.controller");
const commentController = require("../controllers/comment.controller");
const engagementController = require("../controllers/engagement.controller");
const adminController = require("../controllers/admin.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// ─── Article CRUD ───────────────────────────

// Get published articles feed (public)
router.get("/", articleController.getFeed);

// Get current user's drafts (protected — must be before /:slug)
router.get("/user/drafts", authenticate, articleController.getDrafts);

// Create an article (protected)
router.post("/", authenticate, articleController.createArticle);

// Get article by slug (public)
router.get("/:slug", articleController.getArticle);

// Update article (protected)
router.put("/:id", authenticate, articleController.updateArticle);

// Delete article (protected)
router.delete("/:id", authenticate, articleController.deleteArticle);

// ─── Engagement ─────────────────────────────

// Record a read (protected)
router.post("/:id/read", authenticate, articleController.recordRead);

// Toggle like (protected)
router.post("/:articleId/like", authenticate, engagementController.toggleLike);

// Record share (protected)
router.post(
  "/:articleId/share",
  authenticate,
  engagementController.shareArticle,
);

// Toggle save/bookmark (protected)
router.post("/:articleId/save", authenticate, engagementController.toggleSave);

// ─── Comments ───────────────────────────────

// Get comments for an article (public)
router.get("/:articleId/comments", commentController.getComments);

// Add comment (protected)
router.post("/:articleId/comments", authenticate, commentController.addComment);

// ─── Report ─────────────────────────────────

// Report an article (protected)
router.post("/:articleId/report", authenticate, adminController.reportArticle);

module.exports = router;
