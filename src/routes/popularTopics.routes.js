//get popular topics (from tags)
const express = require("express");
const router = express.Router();
const articleController = require("../controllers/popularTopics.controller");

router.get("/", articleController.getTrendingTopics);

module.exports = router;