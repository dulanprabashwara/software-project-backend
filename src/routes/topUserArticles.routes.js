const { Router } = require("express");
const topUserArticlesController = require("../controllers/topUserArticles.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Following feed 
router.get("/", authenticate, topUserArticlesController.getTopUserArticles);

module.exports = router;
