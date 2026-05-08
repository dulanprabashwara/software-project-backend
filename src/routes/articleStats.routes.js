const express = require("express");
const router = express.Router();
const statsController = require("../controllers/articleStats.controller");
const {authenticate} = require("../middlewares/auth"); // Your Firebase auth middleware

// This matches the URL: GET /api/stats/articles
router.get("/", authenticate, statsController.getUserArticleStats);

module.exports = router;