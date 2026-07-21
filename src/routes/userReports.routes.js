const express = require("express");
const router = express.Router();

const { reportUser } = require("../controllers/userReports.controller");
const { authenticate } = require("../middlewares/auth"); 

// POST /api/reports/user
router.post("/", authenticate, reportUser);

module.exports = router;
