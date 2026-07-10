const { Router } = require("express");
const userController = require("../controllers/user.controller");
const followController = require("../controllers/follow.controller");
const { authenticate, optionalAuth } = require("../middlewares/auth");

const router = Router();

// Search users (public, but rate-limited)
router.get("/search", userController.searchUsers);

// Get current user's full profile (protected)
router.get("/me", authenticate, userController.getMe);

// Update own profile (protected)
router.put("/me", authenticate, userController.updateProfile);
router.put("/profile", authenticate, userController.updateProfile); // Keep old alias just in case

// Delete own account (protected)
router.delete("/me", authenticate, userController.deleteAccount);

// Get user email by userId (protected - email is sensitive)
// Using query parameter to avoid route conflict with /:identifier
router.get("/email", authenticate, userController.getUserEmail);

// User profile by ID or username (public, but optionalAuth so isFollowing works)
router.get("/:identifier", optionalAuth, userController.getProfile);

// Follow system (protected)
router.post("/:userId/follow", authenticate, followController.toggleFollow);
router.get("/:userId/followers", followController.getFollowers);
router.get("/:userId/following", followController.getFollowing);

module.exports = router;
