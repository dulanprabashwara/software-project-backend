const { Router } = require("express");
const paymentController = require("../controllers/payment.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Public — get active offers (no auth required)
router.get("/offers", paymentController.getActiveOffers);

// Webhook — must be BEFORE any body-parsing middleware (handled in index.js)
router.post("/webhook", paymentController.handleWebhook);

// Protected routes — require authentication
router.post("/create-checkout-session", authenticate, paymentController.createCheckoutSession);
router.get("/subscription", authenticate, paymentController.getSubscriptionStatus);
router.post("/cancel", authenticate, paymentController.cancelSubscription);
router.post("/portal", authenticate, paymentController.createPortalSession);

module.exports = router;
