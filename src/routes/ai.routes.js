const express = require("express");
const router  = express.Router();
const aiController = require("../controllers/ai.controller");
const { authenticate, requirePremium } = require("../middlewares/auth");

router.post("/analyze",        authenticate, requirePremium, aiController.analyzePrompt);
router.post("/generate",       authenticate, requirePremium, aiController.generateArticle);
router.post("/regenerate",     authenticate, requirePremium, aiController.regenerateArticle);
router.post("/save-draft",     authenticate, requirePremium, aiController.saveDraft);
router.post("/load-to-editor", authenticate, requirePremium, aiController.loadToEditor);

// Article log list — no premium required to view your history
router.get("/logs",            authenticate, aiController.getArticleLogs);
router.get("/logs/:id",        authenticate, aiController.getArticleLogById);

// Soft delete — marks deletedAt, disappears from list, restorable for 1 hour
router.delete("/logs/:id",            authenticate, aiController.deleteLog);

// Restore — clears deletedAt, reappears in list (only within 1 hour of deletion)
router.post("/logs/:id/restore",      authenticate, aiController.restoreLog);

module.exports = router;
