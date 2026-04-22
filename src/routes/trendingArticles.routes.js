 
const express = require("express");
const router = express.Router();
const trendingArticlesController = require("../controllers/trendingArticles.controller");



router.get("/trending", trendingArticlesController.getTrending);

module.exports = router;

