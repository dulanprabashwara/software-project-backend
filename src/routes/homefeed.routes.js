// backend/routes/article.route.js
const express = require("express");
const router = express.Router();
const homefeedController = require("../controllers/homefeed.controller");
const { authenticate } = require("../middlewares/auth");

router.use(authenticate);

// GET /api/articles/main
router.get("/main", homefeedController.getMainFeed);
router.get("/following", homefeedController.getFollowingFeed);
 

module.exports = router;