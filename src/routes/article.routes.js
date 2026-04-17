/* software-project-backend/src/routes/article.routes.js */

const { Router } = require("express");
const articleController = require("../controllers/article.controller");
const commentController = require("../controllers/comment.controller");
const engagementController = require("../controllers/engagement.controller");
const adminController = require("../controllers/admin.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Article CRUD
router.get("/", articleController.getFeed);
router.get("/user/drafts", authenticate, articleController.getDrafts);
router.get("/user/editing", authenticate, articleController.getCurrentEditing);
router.get("/id/:id", authenticate, articleController.getArticleById);
router.post("/", authenticate, articleController.createArticle);

router.post("/:id/edit-existing/start",authenticate,articleController.startEditExisting,);
router.put("/:id/edit-existing/autosave",authenticate,articleController.autosaveEditExisting,);
router.put("/:id/edit-existing/save-draft",authenticate,articleController.saveEditExistingAsDraft,);
router.post("/:id/edit-existing/discard",authenticate,articleController.discardEditExisting,);

router.get("/:slug", articleController.getArticle);
router.put("/:id", authenticate, articleController.updateArticle);
router.delete("/:id", authenticate, articleController.deleteArticle);

// Engagement
router.post("/:id/read", authenticate, articleController.recordRead);
router.post("/:articleId/like", authenticate, engagementController.toggleLike);
router.post("/:articleId/share",authenticate,engagementController.shareArticle,);
router.post("/:articleId/save", authenticate, engagementController.toggleSave);

// Comments
router.get("/:articleId/comments", commentController.getComments);
router.post("/:articleId/comments", authenticate, commentController.addComment);

// Report
router.post("/:articleId/report", authenticate, adminController.reportArticle);

module.exports = router;