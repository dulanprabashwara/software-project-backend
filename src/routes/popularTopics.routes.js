const express = require("express");
const router = express.Router();
const articleController = require("../controllers/popularTopics.controller");

// GET /api/articles/trending-topics
router.get("/", articleController.getTrendingTopics);

module.exports = router;