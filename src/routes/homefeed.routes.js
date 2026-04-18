const express = require("express");
const router = express.Router();
const homefeedController = require("../controllers/homefeed.controller");

// This defines the final part of the URL: /api/articles/
router.get("/", homefeedController.getFeed);

module.exports = router;