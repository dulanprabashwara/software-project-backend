const Stripe = require("stripe");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ─── Create or retrieve a Stripe Customer ───
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

// Create Checkout Session
const createCheckoutSession = async (userId, offerId = null) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("User not found.");
  if (user.isPremium)
    throw ApiError.badRequest("You are already a premium member.");

  const customerId = await getOrCreateStripeCustomer(user);

  // Check Stripe directly for any active subscriptions to prevent duplicates
  const existingSubscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
  });

  if (existingSubscriptions.data.length > 0) {
    // In case the local DB was out of sync (e.g. webhook failed), sync it now
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
    success_url: `${process.env.CLIENT_URL}/home?checkout=success`,
    cancel_url: `${process.env.CLIENT_URL}/subscription/upgrade-to-premium`,
    metadata: {
      userId: user.id,
    },
  };

  // If an offer is selected, apply its coupon to the session params
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

//Handle Webhook Events
const handleWebhookEvent = async (event) => {
  console.log(`🔔 Webhook received: ${event.type}`);
  switch (event.type) {
    case "checkout.session.completed": {
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

      // Create subscription record in our DB
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
      const subscription = event.data.object;

      // If the user clicked cancel in the portal (which defaults to cancel at period end),
      // we forcefully cancel it immediately here so you don't have to wait to test again.
      if (subscription.cancel_at_period_end === true) {
        console.log(
          `⚠️ Subscription set to cancel at period end. Forcing immediate cancellation for testing: ${subscription.id}`,
        );
        await stripe.subscriptions.cancel(subscription.id);
        // This triggers 'customer.subscription.deleted' next, which actually updates the DB.
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const stripeSubscriptionId = subscription.id;
      const customerId = subscription.customer;

      // Find the subscription in our DB
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
      } else if (customerId) {
        // Fallback: If we missed the checkout webhook, the subscription row won't exist.
        // Downgrade the user anyway by looking up their stripeCustomerId.
        const user = await prisma.user.findUnique({
          where: { stripeCustomerId: customerId },
        });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { isPremium: false },
          });
          console.log(
            `❌ User ${user.id} subscription canceled (fallback via customerId)`,
          );
        }
      }
      break;
    }

    case "invoice.payment_failed": {
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

// ─── Get Subscription Status ────────────────
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

// ─── Cancel Subscription ────────────────────
const cancelSubscription = async (userId) => {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  if (!subscription) {
    throw ApiError.notFound("No active subscription found.");
  }

  // Cancel immediately for testing purposes
  await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);

  return { message: "Subscription has been canceled immediately." };
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
  cancelSubscription,
  createPortalSession,
  getActiveOffers,
};
