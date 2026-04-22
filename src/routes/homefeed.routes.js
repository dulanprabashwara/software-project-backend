// backend/routes/article.route.js
const express = require("express");
const router = express.Router();
const homefeedController = require("../controllers/homefeed.controller");

// GET /api/articles/main
router.get("/main", homefeedController.getMainFeed);

 

module.exports = router;