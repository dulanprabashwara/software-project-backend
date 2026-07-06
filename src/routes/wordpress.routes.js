// src/routes/wordpress.routes.js
// Maps WordPress OAuth and publishing endpoints to their controller functions.

const { Router }    = require("express");
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

// OAuth callback is an unauthenticated route — WordPress.com calls it directly
// with the auth code. User identity is verified via the state param instead.
router.get("/callback", handleCallback);

router.use(authenticate);

router.get("/auth",                      initiateAuth);
router.get("/status",                    getStatus);
router.delete("/disconnect",             disconnect);
router.post("/publish",                  publishToWordPress);
router.get("/publish-status/:articleId", getPublishStatus);

module.exports = router;
