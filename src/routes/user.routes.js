const { Router } = require("express");
const userController = require("../controllers/user.controller");
const followController = require("../controllers/follow.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Search users (public, but rate-limited)
router.get("/search", userController.searchUsers);

// Get current user's full profile (protected)
router.get("/me", authenticate, userController.getMe);

// Update own profile (protected)
router.put("/me", authenticate, userController.updateProfile);
router.put("/profile", authenticate, userController.updateProfile); // Keep old alias just in case

// User profile by ID or username (public)
router.get("/:identifier", userController.getProfile);

// Follow system (protected)
router.post("/:userId/follow", authenticate, followController.toggleFollow);
router.get("/:userId/followers", followController.getFollowers);
router.get("/:userId/following", followController.getFollowing);

module.exports = router;
