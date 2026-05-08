//get users read history
const express = require("express");
const router = express.Router();
const readHistoryController = require("../controllers/readHistory.controller");
const { authenticate } = require("../middlewares/auth");

router.use(authenticate);

router.get("/", readHistoryController.getReadHistory); //get articles
router.post("/record", readHistoryController.markAsRead); //put article into read history

 module.exports = router;