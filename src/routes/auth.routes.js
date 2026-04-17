const { Router } = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middlewares/auth");
const { authLimiter } = require("../middlewares/rateLimiter");

/**
 * @fileoverview Authentication Routes Map
 * @description
 * Defines the public and protected endpoints for user authentication.
 * WHY: This provides the explicit API contract for the frontend to interact with our 
 * identity system. It correctly applies rate limiting (`authLimiter`) to public endpoints 
 * to prevent brute forcing, and applies token validation (`authenticate`) to protected endpoints.
 */
const router = Router();

// Public routes
router.post("/register", authLimiter, authController.register);
router.post("/sync", authLimiter, authController.sync);

// Protected routes
router.get("/me", authenticate, authController.getMe);

module.exports = router;
