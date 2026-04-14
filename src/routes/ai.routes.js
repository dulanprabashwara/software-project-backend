const express = require("express");
const router  = express.Router();
const aiController = require("../controllers/ai.controller");
const { authenticate, requirePremium } = require("../middlewares/auth");

router.post("/analyze",         authenticate, requirePremium, aiController.analyzePrompt);
router.post("/generate",        authenticate, requirePremium, aiController.generateArticle);
router.post("/regenerate",      authenticate, requirePremium, aiController.regenerateArticle);
router.post("/save-draft",      authenticate, requirePremium, aiController.saveDraft);

// POST /api/ai/load-to-editor
// Requires premium because editing AI articles is a premium feature.
// Creates an Article (status: EDITING, isAiGenerated: true) from the log,
// returns articleId so the frontend can navigate to /write/create.
router.post("/load-to-editor",  authenticate, requirePremium, aiController.loadToEditor);

router.get("/logs",             authenticate, aiController.getArticleLogs);
router.get("/logs/:id",         authenticate, aiController.getArticleLogById);

module.exports = router;
