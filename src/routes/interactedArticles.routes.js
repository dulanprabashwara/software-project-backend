const express = require("express");
const router = express.Router();
const { getMyInteractedArticles, getMyInteractedList } = require("../controllers/interactedArticles.controller");
const { authenticate } = require("../middlewares/auth"); 

router.get("/", authenticate, getMyInteractedArticles);
router.get("/interactedList", authenticate, getMyInteractedList);


module.exports = router;