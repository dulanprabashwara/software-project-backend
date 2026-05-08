//user rating for a certain article
const express = require("express");
const router = express.Router();
const { getMyArticleRatings } = require("../controllers/articleRatings.controller");

 const { authenticate } = require("../middlewares/auth"); 

 router.get("/", authenticate, getMyArticleRatings);

module.exports = router;