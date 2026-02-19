const { Router } = require("express");
const engagementController = require("../controllers/engagement.controller");
const followController = require("../controllers/follow.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// All library routes are protected
router.use(authenticate);

// Saved articles (bookmarks)
router.get("/saved", engagementController.getSavedArticles);

// Read history
router.get("/history", engagementController.getReadHistory);

module.exports = router;
