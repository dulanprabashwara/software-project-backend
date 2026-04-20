// backend/routes/articleRead.route.js
const express = require("express");
const router = express.Router();
const articleReadController = require("../controllers/articleRead.controller");

 

// Route for reading a specific article (fetched by ID)
router.get("/", articleReadController.getArticleById);

module.exports = router;