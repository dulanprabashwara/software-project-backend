//notification routes
const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");

const { authenticate } = require("../middlewares/auth"); 
router.use(authenticate);

router.get("/", notificationController.getNotifications); //get all notifications available
router.post("/mark-read", notificationController.markAsRead); //mark notifications as read

module.exports = router;