const express = require("express");
const router = express.Router();
const { getNotifications, markAsRead } = require("../controllers/notification.controller");
const { authenticate } = require("../middlewares/auth");

// All notification routes require a logged-in user
router.use(authenticate);

router.get("/", getNotifications);
router.patch("/:id/read", markAsRead);

module.exports = router;