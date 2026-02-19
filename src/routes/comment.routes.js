const { Router } = require("express");
const commentController = require("../controllers/comment.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Update a comment (protected)
router.put("/:id", authenticate, commentController.updateComment);

// Delete a comment (protected)
router.delete("/:id", authenticate, commentController.deleteComment);

module.exports = router;
