const { Router } = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middlewares/auth");
const { authLimiter } = require("../middlewares/rateLimiter");

const router = Router();

// Public routes
router.post("/register", authLimiter, authController.register);
router.post("/sync", authLimiter, authController.sync);

// Protected routes
router.get("/me", authenticate, authController.getMe);

module.exports = router;
