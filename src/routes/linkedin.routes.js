const { Router } = require("express");
const linkedinController = require("../controllers/linkedin.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// OAuth callback does NOT need auth middleware because it's a redirect from LinkedIn
router.get("/callback", linkedinController.handleCallback);

// All other routes require authentication
router.use(authenticate);

router.get("/auth", linkedinController.initiateAuth);
router.get("/status", linkedinController.getStatus);
router.delete("/disconnect", linkedinController.disconnect);
router.post("/publish", linkedinController.publishArticle);
router.get("/publish-status/:articleId", linkedinController.getPublishStatus);

module.exports = router;
