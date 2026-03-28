const express = require("express");
const router  = express.Router();
const aiController = require("../controllers/ai.controller");
const { authenticate, requirePremium } = require("../middlewares/auth");

// All AI routes require:
//   1. authenticate  — verifies Firebase ID token, attaches req.user (Prisma User record)
//   2. requirePremium — blocks non-premium users (admins bypass this automatically)

router.post("/analyze",    authenticate, requirePremium, aiController.analyzePrompt);
router.post("/generate",   authenticate, requirePremium, aiController.generateArticle);
router.post("/regenerate", authenticate, requirePremium, aiController.regenerateArticle);
router.post("/save-draft", authenticate, requirePremium, aiController.saveDraft);

// GET routes don't require premium — any logged-in user can view their own logs
router.get("/logs",     authenticate, aiController.getArticleLogs);
router.get("/logs/:id", authenticate, aiController.getArticleLogById);

module.exports = router;