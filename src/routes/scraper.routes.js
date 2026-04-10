// src/routes/scraper.routes.js
const express           = require("express");
const router            = express.Router();
const scraperController = require("../controllers/scraper.controller");
const { authenticate, authorize } = require("../middlewares/auth");

router.use(authenticate, authorize("ADMIN"));

router.post("/trigger",             scraperController.triggerScraping);
router.post("/enrich",             scraperController.triggerEnrichment);
router.get("/sessions",             scraperController.getSessions);
router.get("/sessions/:sessionId",  scraperController.getSessionById);
router.get("/articles",             scraperController.getScrapedArticles);

module.exports = router;
