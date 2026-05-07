// tests/payments/payment.service.test.js
const { getSubscriptionStatus, cancelSubscription, createPortalSession, getActiveOffers } = require("../../src/services/payment.service");
const prisma = require("../../src/config/prisma");
const ApiError = require("../../src/utils/ApiError");

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

jest.mock("stripe", () => {
  const mCancel = jest.fn();
  const mPortalCreate = jest.fn();
  return jest.fn().mockImplementation(() => ({
    subscriptions: {
      cancel: mCancel,
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
    billingPortal: {
      sessions: {
        create: mPortalCreate,
      },
    },
    customers: {
      create: jest.fn().mockResolvedValue({ id: "cus_123" }),
    },
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: "http://checkout.url" }),
      },
    },
  }));
});

const stripe = require("stripe")();
const mockCancel = stripe.subscriptions.cancel;
const mockPortalSessionCreate = stripe.billingPortal.sessions.create;

describe("Payment Service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getSubscriptionStatus", () => {
    test("should return premium status and subscription details", async () => {
      const mockSub = { id: "sub-1", status: "active" };
      prisma.subscription.findFirst.mockResolvedValue(mockSub);
      prisma.user.findUnique.mockResolvedValue({ isPremium: true });

      const result = await getSubscriptionStatus("user-1");

      expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1", status: "active" } })
      );
      expect(result.isPremium).toBe(true);
      expect(result.subscription).toEqual(mockSub);
    });

    test("should return false if user is not premium", async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ isPremium: false });

      const result = await getSubscriptionStatus("user-1");

      expect(result.isPremium).toBe(false);
      expect(result.subscription).toBeNull();
    });
  });

  describe("cancelSubscription", () => {
    test("should cancel the subscription via Stripe", async () => {
      prisma.subscription.findFirst.mockResolvedValue({ stripeSubscriptionId: "sub_123" });
      mockCancel.mockResolvedValue({});

      const result = await cancelSubscription("user-1");

      expect(mockCancel).toHaveBeenCalledWith("sub_123");
      expect(result.message).toContain("canceled immediately");
    });

    test("should throw NotFound if user has no active subscription", async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await expect(cancelSubscription("user-1")).rejects.toThrow(ApiError);
      await expect(cancelSubscription("user-1")).rejects.toThrow("No active subscription found.");
    });
  });

  describe("createPortalSession", () => {
    test("should return portal session URL for customer", async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: "cus_123" });
      mockPortalSessionCreate.mockResolvedValue({ url: "http://portal.url" });

      const result = await createPortalSession("user-1");

      expect(mockPortalSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_123" })
      );
      expect(result.url).toBe("http://portal.url");
    });

    test("should throw BadRequest if user has no stripeCustomerId", async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: null });

      await expect(createPortalSession("user-1")).rejects.toThrow("No Stripe customer found.");
    });
  });

  describe("getActiveOffers", () => {
    test("should return active offers from database", async () => {
      const mockOffers = [{ id: "offer-1" }];
      prisma.offer.findMany.mockResolvedValue(mockOffers);

      const result = await getActiveOffers();

      expect(prisma.offer.findMany).toHaveBeenCalledWith({
        where: { is_active: true },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(mockOffers);
    });
  });
});
