//to create the router object
const express = require("express");
const router = express.Router();


const {  saveArticle, unsaveArticle, getMySavedArticles,getMySavedList } = require("../controllers/savedArticle.controller");//get 
const { authenticate } = require("../middlewares/auth"); 

 
router.get("/", authenticate, getMySavedArticles);
router.get("/savedList", authenticate, getMySavedList);

router.post("/", authenticate, saveArticle);
router.delete("/", authenticate, unsaveArticle);

module.exports = router;