const express = require("express");
const router  = express.Router();
const aiController = require("../controllers/ai.controller");
const { authenticate, requirePremium } = require("../middlewares/auth");

// Premium-only: AI generation flow
router.post("/analyze",        authenticate, requirePremium, aiController.analyzePrompt);
router.post("/generate",       authenticate, requirePremium, aiController.generateArticle);
router.post("/regenerate",     authenticate, requirePremium, aiController.regenerateArticle);
router.post("/save-draft",     authenticate, requirePremium, aiController.saveDraft);
router.post("/load-to-editor", authenticate, requirePremium, aiController.loadToEditor);

// Article log management (all authenticated users)
router.get("/logs",              authenticate, aiController.getArticleLogs);
router.get("/logs/:id",          authenticate, aiController.getArticleLogById);
router.delete("/logs/:id",       authenticate, aiController.deleteLog);
router.post("/logs/:id/restore", authenticate, aiController.restoreLog);

// User reaction on a generated article (like / dislike toggle)
router.patch("/logs/:id/response", authenticate, aiController.setUserResponse);

// Sidebar data endpoints
router.get("/trending-keywords", authenticate, aiController.getTrendingKeywords);
router.get("/top-ai-articles",   authenticate, aiController.getTopAIArticles);

module.exports = router;
