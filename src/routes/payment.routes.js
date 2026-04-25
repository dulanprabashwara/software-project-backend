const { Router } = require("express");
const paymentController = require("../controllers/payment.controller");
const { authenticate } = require("../middlewares/auth");

const router = Router();

// Public — get active offers
router.get("/offers", paymentController.getActiveOffers);

// Webhook — must be BEFORE any body-parsing middleware. send the stripe http request to this route
router.post("/webhook", paymentController.handleWebhook);

// Protected routes — require authentication
//create the checkout session when the user want to subscribe
router.post(
  "/create-checkout-session",
  authenticate,
  paymentController.createCheckoutSession,
);
// get user's current subscription status
router.get(
  "/subscription",
  authenticate,
  paymentController.getSubscriptionStatus,
);

//create the customer portal session to manage the subscription when the user want to update or cancel the subscription
router.post("/portal", authenticate, paymentController.createPortalSession);

module.exports = router;
