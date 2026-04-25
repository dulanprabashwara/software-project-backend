const Stripe = require("stripe");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const paymentService = require("../services/payment.service");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ─── Create Checkout Session ────────────────
const createCheckoutSession = asyncHandler(async (req, res) => {
  const { offerId } = req.body;
  const result = await paymentService.createCheckoutSession(req.user.id, offerId);
  sendSuccess(res, { data: result });
});

// ─── Stripe Webhook ─────────────────────────
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
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log("✅ Webhook verified. Event type:", event.type);
  } catch (err) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await paymentService.handleWebhookEvent(event);
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
  createPortalSession,
  getActiveOffers,
};
