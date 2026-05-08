 //get trending articles
const express = require("express");
const router = express.Router();
const trendingArticlesController = require("../controllers/trendingArticles.controller");



router.get("/trendingTitles", trendingArticlesController.getTrendingTitles); //just the titles and the author name
router.get("/trendingArticles", trendingArticlesController.getTrendingArticles); //get all article details


module.exports = router;

