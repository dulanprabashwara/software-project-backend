// backend/routes/article.route.js
const express = require("express");
const router = express.Router();
const homefeedController = require("../controllers/homefeed.controller");

// GET /api/articles/main
router.get("/main", homefeedController.getMainFeed);

// GET /api/articles/trending
router.get("/trending", homefeedController.getTrending);

module.exports = router;