const { Router } = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middlewares/auth");
const { authLimiter } = require("../middlewares/rateLimiter");

// Defines the public and protected endpoints for user authentication.
// applies rate limiting to public endpoints to prevent brute forcing, and applies token validation  to protected endpoints.

const router = Router();

// for manual email & password registration
router.post("/register", authLimiter, authController.register);
//for google, facebook sign up
router.post("/sync", authLimiter, authController.sync);

// for getting the user raw info (only logged in users)
router.get("/me", authenticate, authController.getMe);

module.exports = router;
