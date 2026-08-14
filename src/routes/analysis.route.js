const { Router } = require("express");
const { authenticate } = require("../middlewares/auth");
const analysisController = require("../controllers/analysis.controller");

const router = Router();

// Route for Plagiarism and AI Content Analysis
router.post("/check", authenticate, analysisController.checkContent);

module.exports = router;
