//src\routes\wordpress.routes.js

const { Router } = require("express");
const { authenticate } = require("../middlewares/auth");
const {
  initiateAuth,
  handleCallback,
  getStatus,
  disconnect,
  publishToWordPress,
  getPublishStatus,
} = require("../controllers/wordpress.controller");

const router = Router();

// OAuth callback is called by WordPress.com's servers — no auth header here.
// Authentication is derived from the state param instead.
router.get("/callback", handleCallback);

// All other routes require the user to be logged in.
router.use(authenticate);

router.get("/auth", initiateAuth);
router.get("/status", getStatus);
router.delete("/disconnect", disconnect);
router.post("/publish", publishToWordPress);
router.get("/publish-status/:articleId", getPublishStatus);

module.exports = router;
