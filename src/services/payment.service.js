const Stripe = require("stripe");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

// @ts-ignore
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

// ─── Create or retrieve a Stripe customerId from strip to use in createCheckoutSession ───
const getOrCreateStripeCustomer = async (user) => {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.displayName || user.username,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
};

// ─── Create Checkout Session  url by giving id, offerid, and all params required to strip and renturn it to the user to redirect the user to the checkout page ────────────────
const createCheckoutSession = async (userId, offerId = null) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("User not found.");
  if (user.isPremium)
    throw ApiError.badRequest("You are already a premium member.");

  const customerId = await getOrCreateStripeCustomer(user);

  // Check if there are any existing subscriptions in strip for that user
  const existingSubscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
  });

  if (existingSubscriptions.data.length > 0) {
    // In case the existing subscription user is not premium in the database update the user in the db to be premium
    if (!user.isPremium) {
      await prisma.user.update({
        where: { id: userId },
        data: { isPremium: true },
      });
    }
    throw ApiError.badRequest(
      "You already have an active subscription. Please manage your existing subscription in the Customer Portal.",
    );
  }

  // Build session params
  const sessionParams = {
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${process.env.CLIENT_URL}/subscription/success`,
    cancel_url: `${process.env.CLIENT_URL}/subscription/cancel`,
    metadata: {
      userId: user.id,
    },
  };

  // If an offer is selected put its couponid and offer id to the session params
  if (offerId) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || !offer.is_active) {
      throw ApiError.badRequest("This offer is not available.");
    }

    if (offer.stripe_coupon_id) {
      sessionParams.discounts = [{ coupon: offer.stripe_coupon_id }];
      sessionParams.metadata.offerId = offer.id;
    }
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url };
};

// ─── Handle Webhook Events received from stripe ──────────────────
const handleWebhookEvent = async (event) => {
  console.log(`🔔 Webhook received: ${event.type}`);
  switch (event.type) {
    //if session completed create a subscription row in the db for the user and update the user as premium in the db
    case "checkout.session.completed": {
      //get the stripe session data from the event
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const offerId = session.metadata?.offerId || null;
      const subscriptionId = session.subscription;

      if (!userId || !subscriptionId) {
        console.warn(
          "Webhook: Missing userId or subscriptionId in session metadata",
        );
        return;
      }

      // Fetch subscription details from Stripe
      const stripeSubscription =
        await stripe.subscriptions.retrieve(subscriptionId);

      // Debug: log the subscription to see the structure
      console.log(
        "Stripe subscription object keys:",
        Object.keys(stripeSubscription),
      );
      console.log("current_period_end:", stripeSubscription.current_period_end);
      console.log(
        "items:",
        JSON.stringify(stripeSubscription.items?.data?.[0]?.current_period_end),
      );

      // Safely parse the period end date — it may be a Unix timestamp or undefined
      let periodEnd = null;
      const rawPeriodEnd =
        stripeSubscription.current_period_end ||
        stripeSubscription.items?.data?.[0]?.current_period_end;

      if (rawPeriodEnd && !isNaN(rawPeriodEnd)) {
        periodEnd = new Date(rawPeriodEnd * 1000);
      }

      // Create subscription record for the user in our DB
      await prisma.subscription.upsert({
        where: { stripeSubscriptionId: subscriptionId },
        update: {
          status: "active",
          offerId: offerId,
          stripeCurrentPeriodEnd: periodEnd,
        },
        create: {
          userId,
          offerId,
          stripeSubscriptionId: subscriptionId,
          status: "active",
          stripeCurrentPeriodEnd: periodEnd,
        },
      });

      // Set user as premium
      await prisma.user.update({
        where: { id: userId },
        data: { isPremium: true },
      });

      console.log(`✅ User ${userId} upgraded to premium`);
      break;
    }

    case "customer.subscription.updated": {
      // if user cancel the subscription from the billing portal send the updated hook to backend
      const subscription = event.data.object;
      if (subscription.cancel_at_period_end === true) {
        console.log(
          `⚠️ Subscription set to cancel at period end. Forcing immediate cancellation for testing: ${subscription.id}`,
        );
        await stripe.subscriptions.cancel(subscription.id);
        // This triggers deleted hook to update the databse when cancel the subscription right after without waiting for the period end
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const stripeSubscriptionId = subscription.id;

      // Find the subscription row in our DB
      const dbSubscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId },
      });

      if (dbSubscription) {
        // Update subscription status
        await prisma.subscription.update({
          where: { stripeSubscriptionId },
          data: { status: "canceled" },
        });

        // Remove premium from user
        await prisma.user.update({
          where: { id: dbSubscription.userId },
          data: { isPremium: false },
        });

        console.log(`❌ User ${dbSubscription.userId} subscription canceled`);
      }
      break;
    }

    case "invoice.payment_failed": {
      // if payment failed update subscription in the db to be past_due
      const invoice = event.data.object;
      const stripeSubscriptionId = invoice.subscription;

      if (stripeSubscriptionId) {
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId },
          data: { status: "past_due" },
        });
        console.log(
          `⚠️ Payment failed for subscription ${stripeSubscriptionId}`,
        );
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
};

// ─── Get Subscription with the isPremium status from DB────────────────
const getSubscriptionStatus = async (userId) => {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
    include: { offer: true },
    orderBy: { createdAt: "desc" },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true },
  });

  return {
    isPremium: user?.isPremium || false,
    subscription: subscription || null,
  };
};

// ─── Create Customer Portal Session ─────────
const createPortalSession = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeCustomerId) {
    throw ApiError.badRequest("No Stripe customer found. Subscribe first.");
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${process.env.CLIENT_URL}/home`,
  });

  return { url: portalSession.url };
};

// ─── Get Active Offers (public) ─────────────
const getActiveOffers = async () => {
  return prisma.offer.findMany({
    where: { is_active: true },
    orderBy: { createdAt: "desc" },
  });
};

module.exports = {
  createCheckoutSession,
  handleWebhookEvent,
  getSubscriptionStatus,
  createPortalSession,
  getActiveOffers,
};
