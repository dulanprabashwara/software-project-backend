const { Router } = require("express");
const userController = require("../controllers/user.controller");
const followController = require("../controllers/follow.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Search users (public, but rate-limited)
router.get("/search", userController.searchUsers);

// Update own profile (protected)
router.put("/profile", authenticate, userController.updateProfile);

// User profile by ID or username (public)
router.get("/:identifier", userController.getProfile);

// Follow system (protected)
router.post("/:userId/follow", authenticate, followController.toggleFollow);
router.get("/:userId/followers", followController.getFollowers);
router.get("/:userId/following", followController.getFollowing);

module.exports = router;
