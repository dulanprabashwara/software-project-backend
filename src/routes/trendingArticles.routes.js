 
const express = require("express");
const router = express.Router();
const trendingArticlesController = require("../controllers/trendingArticles.controller");



router.get("/trendingTitles", trendingArticlesController.getTrendingTitles);
router.get("/trendingArticles", trendingArticlesController.getTrendingArticles);


module.exports = router;

