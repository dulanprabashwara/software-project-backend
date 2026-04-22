const express = require("express");
const router = express.Router();
const { 
  saveArticle, 
  unsaveArticle, 
  getMySavedArticles 
} = require("../controllers/savedArticle.controller");
const { authenticate } = require("../middlewares/auth"); 

// All routes require authentication
router.get("/", authenticate, getMySavedArticles);
router.post("/", authenticate, saveArticle);
router.delete("/", authenticate, unsaveArticle);

module.exports = router;