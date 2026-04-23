const express = require("express");
const router  = express.Router();
const aiController = require("../controllers/ai.controller");
const { authenticate, requirePremium } = require("../middlewares/auth");

router.post("/analyze",        authenticate, requirePremium, aiController.analyzePrompt);
router.post("/generate",       authenticate, requirePremium, aiController.generateArticle);
router.post("/regenerate",     authenticate, requirePremium, aiController.regenerateArticle);
router.post("/save-draft",     authenticate, requirePremium, aiController.saveDraft);
router.post("/load-to-editor", authenticate, requirePremium, aiController.loadToEditor);

router.get("/logs",            authenticate, aiController.getArticleLogs);
router.get("/logs/:id",        authenticate, aiController.getArticleLogById);

router.delete("/logs/:id",         authenticate, aiController.deleteLog);
router.post("/logs/:id/restore",   authenticate, aiController.restoreLog);


router.get("/trending-topics", authenticate, aiController.getTrendingTopics);

module.exports = router;
