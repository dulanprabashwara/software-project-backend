const { Router } = require("express");
const notificationController = require("../controllers/notification.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// All notification routes are protected
router.use(authenticate);

router.get("/", notificationController.getNotifications);
router.put("/read", notificationController.markAsRead);

module.exports = router;
