const express = require("express");
const router = express.Router();
const { getMyArticleRatings } = require("../controllers/articleRatings.controller");

// NOTE: Adjust the path below to match where your Firebase auth middleware is located
const { authenticate } = require("../middlewares/auth"); 

// GET /api/articleRatings
router.get("/", authenticate, getMyArticleRatings);

module.exports = router;