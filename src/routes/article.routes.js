/* software-project-backend/src/routes/article.routes.js */

const { Router } = require("express");
const articleController = require("../controllers/article.controller");
const commentController = require("../controllers/comment.controller");
const engagementController = require("../controllers/engagement.controller");
const adminController = require("../controllers/admin.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();


//Trending articles
router.get("/trending", articleController.getTrendingArticles);

// Article CRUD
router.get("/", articleController.getFeed);
router.get("/user/drafts", authenticate, articleController.getDrafts);
router.get("/user/editing", authenticate, articleController.getCurrentEditing);
router.get("/user/published", authenticate, articleController.getPublishedByUser);
router.get("/id/:id", authenticate, articleController.getArticleById);
router.post("/", authenticate, articleController.createArticle);
router.post("/:id/publish", authenticate, articleController.publishArticle);


// Edit existing
router.post("/:id/edit-existing/start",authenticate,articleController.startEditExisting,);
router.put("/:id/edit-existing/autosave",authenticate,articleController.autosaveEditExisting,);
router.put("/:id/edit-existing/save-draft",authenticate,articleController.saveEditExistingAsDraft,);
router.post("/:id/edit-existing/discard",authenticate,articleController.discardEditExisting,);

// Edit as new
router.post("/:id/edit-as-new/start",authenticate,articleController.startEditAsNew,);
router.put("/:id/edit-as-new/autosave",authenticate,articleController.autosaveEditAsNew,);
router.put("/:id/edit-as-new/save-draft",authenticate,articleController.saveEditAsNewAsDraft,);
router.post("/:id/edit-as-new/discard",authenticate,articleController.discardEditAsNew,
);

// Public article read
router.get("/:slug", articleController.getArticle);
router.put("/:id", authenticate, articleController.updateArticle);
router.delete("/:id", authenticate, articleController.deleteArticle);

// Engagement
router.post("/:id/read", authenticate, articleController.recordRead);
router.post("/:articleId/like", authenticate, engagementController.toggleLike);
router.post("/:articleId/share",authenticate,engagementController.shareArticle,);
router.post("/:articleId/save", authenticate, engagementController.toggleSave);

 
// Report
router.post("/:articleId/report", authenticate, adminController.reportArticle);

//Trending articles
router.get("/trending", articleController.getTrendingArticles);

module.exports = router;