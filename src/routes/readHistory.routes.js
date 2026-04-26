const express = require("express");
const router = express.Router();
const readHistoryController = require("../controllers/readHistory.controller");
const { authenticate } = require("../middlewares/auth");

router.use(authenticate);

router.get("/", readHistoryController.getReadHistory);
router.post("/record", readHistoryController.markAsRead);

 module.exports = router;