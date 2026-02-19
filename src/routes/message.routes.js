const { Router } = require("express");
const messageController = require("../controllers/message.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// All message routes are protected
router.use(authenticate);

// Get unread count (before /:userId to avoid conflict)
router.get("/unread/count", messageController.getUnreadCount);

// Get conversation list
router.get("/conversations", messageController.getConversations);

// Get conversation with a user
router.get("/:userId", messageController.getConversation);

// Mark messages from a user as read
router.put("/:userId/read", messageController.markAsRead);

module.exports = router;
