//to file a report against an article
const express = require("express");
const router = express.Router();

const { createReport } = require("../controllers/articleReports.controller");
const { authenticate } = require("../middlewares/auth"); 

// POST /api/reports (assuming you mount this router at /api/reports)
router.post("/", authenticate, createReport);

module.exports = router;