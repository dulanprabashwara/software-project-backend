const { 
  createCheckoutSession, 
  handleWebhook, 
  getSubscriptionStatus, 
  cancelSubscription, 
  createPortalSession, 
  getActiveOffers 
} = require("../../src/controllers/payment.controller");
const paymentService = require("../../src/services/payment.service");
const { sendSuccess } = require("../../src/utils/response");
const Stripe = require("stripe");

// Mock dependencies
jest.mock("../../src/services/payment.service");
jest.mock("../../src/utils/response", () => ({
  sendSuccess: jest.fn(),
}));

jest.mock("stripe", () => {
  const mStripe = {
    webhooks: {
      constructEvent: jest.fn(),
    },
  };
  return jest.fn(() => mStripe);
});

describe("Payment Controller Unit Tests", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      body: {},
      headers: {},
      user: { id: "user_123" },
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    };

    next = jest.fn();
  });

  describe("createCheckoutSession", () => {
    it("should create a checkout session", async () => {
      req.body = { offerId: "offer_123" };
      const mockResult = { url: "https://checkout.stripe.com/..." };
      paymentService.createCheckoutSession.mockResolvedValue(mockResult);

      await createCheckoutSession(req, res, next);

      expect(paymentService.createCheckoutSession).toHaveBeenCalledWith("user_123", "offer_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, { data: mockResult });
    });
  });

  describe("handleWebhook", () => {
    it("should verify webhook signature and handle event", async () => {
      req.headers["stripe-signature"] = "valid_signature";
      req.body = Buffer.from("mock_raw_body");
      
      const mockEvent = { type: "checkout.session.completed", data: { object: {} } };
      new Stripe().webhooks.constructEvent.mockReturnValue(mockEvent);
      paymentService.handleWebhookEvent.mockResolvedValue();

      await handleWebhook(req, res, next);

      expect(new Stripe().webhooks.constructEvent).toHaveBeenCalledWith(
        req.body,
        "valid_signature",
        process.env.STRIPE_WEBHOOK_SECRET
      );
      expect(paymentService.handleWebhookEvent).toHaveBeenCalledWith(mockEvent);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it("should return 400 if webhook signature verification fails", async () => {
      req.headers["stripe-signature"] = "invalid_signature";
      req.body = Buffer.from("mock_raw_body");
      
      const error = new Error("Invalid signature");
      new Stripe().webhooks.constructEvent.mockImplementation(() => { throw error; });

      await handleWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(`Webhook Error: ${error.message}`);
      expect(paymentService.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it("should return 500 if payment service throws", async () => {
      req.headers["stripe-signature"] = "valid_signature";
      req.body = Buffer.from("mock_raw_body");
      
      const mockEvent = { type: "checkout.session.completed" };
      new Stripe().webhooks.constructEvent.mockReturnValue(mockEvent);
      
      paymentService.handleWebhookEvent.mockRejectedValue(new Error("Service error"));

      await handleWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Webhook handler failed" });
    });
  });

  describe("getSubscriptionStatus", () => {
    it("should return subscription status", async () => {
      const mockResult = { isPremium: true, offer: { title: "Pro" } };
      paymentService.getSubscriptionStatus.mockResolvedValue(mockResult);

      await getSubscriptionStatus(req, res, next);

      expect(paymentService.getSubscriptionStatus).toHaveBeenCalledWith("user_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, { data: mockResult });
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel subscription", async () => {
      paymentService.cancelSubscription.mockResolvedValue({ message: "Subscription cancelled" });

      await cancelSubscription(req, res, next);

      expect(paymentService.cancelSubscription).toHaveBeenCalledWith("user_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, { message: "Subscription cancelled" });
    });
  });

  describe("createPortalSession", () => {
    it("should create portal session", async () => {
      const mockResult = { url: "https://billing.stripe.com/..." };
      paymentService.createPortalSession.mockResolvedValue(mockResult);

      await createPortalSession(req, res, next);

      expect(paymentService.createPortalSession).toHaveBeenCalledWith("user_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, { data: mockResult });
    });
  });

  describe("getActiveOffers", () => {
    it("should return active offers", async () => {
      const mockOffers = [{ id: "1", title: "Pro" }];
      paymentService.getActiveOffers.mockResolvedValue(mockOffers);

      await getActiveOffers(req, res, next);

      expect(paymentService.getActiveOffers).toHaveBeenCalled();
      expect(sendSuccess).toHaveBeenCalledWith(res, { data: mockOffers });
    });
  });
});
