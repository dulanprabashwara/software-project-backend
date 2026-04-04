const { Router } = require("express");
const paymentController = require("../controllers/payment.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// POST /api/stripe/create-portal-session
router.post("/create-portal-session", authenticate, paymentController.createPortalSession);

module.exports = router;
