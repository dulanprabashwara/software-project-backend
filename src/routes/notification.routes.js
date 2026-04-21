const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");

// Import your actual authentication middleware
const { authenticate } = require("../middlewares/auth"); 

// Protect all notification routes
router.use(authenticate);

// GET /api/notifications
router.get("/", notificationController.getNotifications);

// PATCH /api/notifications/mark-read
router.post("/mark-read", notificationController.markAsRead);

module.exports = router;