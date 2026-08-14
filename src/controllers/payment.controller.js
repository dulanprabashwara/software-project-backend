const Stripe = require("stripe");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const paymentService = require("../services/payment.service");
const { logPlatformEvent } = require("../utils/eventLogger");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

//  Create Checkout Session
const createCheckoutSession = asyncHandler(async (req, res) => {
  const { offerId } = req.body;
  const result = await paymentService.createCheckoutSession(
    req.user.id,
    offerId,
  );
  sendSuccess(res, { data: result });
});

//get the  Stripe Webhook sent from the strip in the headers after paying
const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  console.log("━━━ WEBHOOK HIT ━━━");
  console.log("Body type:", typeof req.body);
  console.log("Is Buffer:", Buffer.isBuffer(req.body));
  console.log("Body length:", req.body?.length || 0);
  console.log("Signature present:", !!sig);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    console.log("✅ Webhook verified. Event type:", event.type);
  } catch (err) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    //send the webhook event to the service to handle it
    await paymentService.handleWebhookEvent(event);

    // --- PLATFORM PULSE TRIGGER ---
    if (event.type === "checkout.session.completed") {
      const email = event.data.object?.customer_details?.email || "A user";
      await logPlatformEvent("PREMIUM_UPGRADE", `${email} just upgraded to Premium!`);
    } else if (event.type === "customer.subscription.deleted") {
      await logPlatformEvent("SUBSCRIPTION_CANCELED", "A premium subscription was canceled.");
    }
    // ------------------------------

    res.json({ received: true });
  } catch (err) {
    console.error(`❌ Webhook handler error: ${err.message}`);
    res.status(500).json({ error: "Webhook handler failed" });
  }
};

// ─── Get Subscription Status ────────────────
const getSubscriptionStatus = asyncHandler(async (req, res) => {
  const result = await paymentService.getSubscriptionStatus(req.user.id);
  sendSuccess(res, { data: result });
});

// ─── Cancel Subscription ────────────────────
const cancelSubscription = asyncHandler(async (req, res) => {
  const result = await paymentService.cancelSubscription(req.user.id);
  // --- PLATFORM PULSE TRIGGER ---
  await logPlatformEvent("SUBSCRIPTION_CANCELED", "A user manually canceled their premium subscription.");
  // ------------------------------

  sendSuccess(res, { message: result.message });
});

// ─── Create Portal Session ──────────────────
const createPortalSession = asyncHandler(async (req, res) => {
  const result = await paymentService.createPortalSession(req.user.id);
  sendSuccess(res, { data: result });
});

// ─── Get Active Offers (Public) ─────────────
const getActiveOffers = asyncHandler(async (req, res) => {
  const offers = await paymentService.getActiveOffers();
  sendSuccess(res, { data: offers });
});

module.exports = {
  createCheckoutSession,
  handleWebhook,
  getSubscriptionStatus,
  cancelSubscription,
  createPortalSession,
  getActiveOffers,
};
