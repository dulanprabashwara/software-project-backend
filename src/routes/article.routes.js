/* software-project-backend/src/routes/article.routes.js */

const { Router } = require("express");
const articleController = require("../controllers/article.controller");
const commentController = require("../controllers/comment.controller");
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
router.get("/user/scheduled", authenticate, articleController.getScheduledByUser);
router.get("/id/:id", authenticate, articleController.getArticleById);
router.post("/", authenticate, articleController.createArticle);
router.post("/:id/publish", authenticate, articleController.publishArticle);


// Edit existing
router.post("/:id/edit-existing/start",authenticate,articleController.startEditExisting,);
router.put("/:id/edit-existing/autosave",authenticate,articleController.autosaveEditExisting,);
router.put("/:id/edit-existing/save-draft",authenticate,articleController.saveEditExistingAsDraft,);
router.post("/:id/edit-existing/discard",authenticate,articleController.discardEditExisting,);
router.put("/:id/edit-existing/preview",authenticate,articleController.saveEditExistingForPreview,);
router.put("/:id/edit-existing/clear-backup",authenticate,articleController.clearEditExistingBackup,);

// Edit as new
router.post("/:id/edit-as-new/start",authenticate,articleController.startEditAsNew,);
router.put("/:id/edit-as-new/autosave",authenticate,articleController.autosaveEditAsNew,);
router.put("/:id/edit-as-new/save-draft",authenticate,articleController.saveEditAsNewAsDraft,);
router.post("/:id/edit-as-new/discard",authenticate,articleController.discardEditAsNew,
);

// Edit published
router.post("/:id/edit-published/start", authenticate, articleController.startEditPublished);
router.put("/:id/edit-published/autosave", authenticate, articleController.autosaveEditPublished);
router.put("/:id/edit-published/preview", authenticate, articleController.saveEditPublishedForPreview);
router.put("/:id/edit-published/republish", authenticate, articleController.republishArticle);
router.post("/:id/edit-published/discard", authenticate, articleController.discardEditPublished);

// Public article read
router.get("/author/:username/published", articleController.getPublishedByUsername);
router.get("/:slug", articleController.getArticle);
router.put("/:id", authenticate, articleController.updateArticle);
router.delete("/:id", authenticate, articleController.deleteArticle);

// Engagement
router.post("/:id/read", authenticate, articleController.recordRead);
 
 
// Report
router.post("/:articleId/report", authenticate, adminController.reportArticle);

//Trending articles
router.get("/trending", articleController.getTrendingArticles);

module.exports = router;