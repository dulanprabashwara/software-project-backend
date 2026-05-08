//get saved articles
const express = require("express");
const router = express.Router();


const {  saveArticle, unsaveArticle, getMySavedArticles,getMySavedList } = require("../controllers/savedArticle.controller");//get 
const { authenticate } = require("../middlewares/auth"); 

 
router.get("/", authenticate, getMySavedArticles); //get saved articles as a whole
router.get("/savedList", authenticate, getMySavedList); //get a list of saved IDs

router.post("/", authenticate, saveArticle); //save article
router.delete("/", authenticate, unsaveArticle); //remove from saved

module.exports = router;