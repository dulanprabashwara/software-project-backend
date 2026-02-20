const express = require("express");
const router = express.Router();
const aiController = require("../controllers/ai.controller");

// Auth middleware removed temporarily for development/demo
// TODO: Add back when Firebase auth is integrated in frontend:
// const { authenticate, requirePremium } = require("../middlewares/auth");
// router.post("/analyze",    authenticate, requirePremium, aiController.analyzePrompt);
// router.post("/generate",   authenticate, requirePremium, aiController.generateArticle);
// router.post("/regenerate", authenticate, requirePremium, aiController.regenerateArticle);

router.post("/analyze",    aiController.analyzePrompt);
router.post("/generate",   aiController.generateArticle);
router.post("/regenerate", aiController.regenerateArticle);

module.exports = router;