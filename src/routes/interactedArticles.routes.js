//get interacted articles
const express = require("express");
const router = express.Router();
const { getMyInteractedArticles, getMyInteractedList } = require("../controllers/interactedArticles.controller");
const { authenticate } = require("../middlewares/auth"); 

router.get("/", authenticate, getMyInteractedArticles); //get all article details
router.get("/interactedList", authenticate, getMyInteractedList); //get only a list of IDs


module.exports = router;