const { register, sync, getMe } = require("../../src/controllers/auth.controller");
const authService = require("../../src/services/auth.service");
const admin = require("../../src/config/firebase");
const { sendSuccess } = require("../../src/utils/response");
const ApiError = require("../../src/utils/ApiError");

// Mock dependencies
jest.mock("../../src/services/auth.service");
jest.mock("../../src/utils/eventLogger", () => ({
  logPlatformEvent: jest.fn(),
}));
const mockVerifyIdToken = jest.fn();
jest.mock("../../src/config/firebase", () => ({
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
}));
jest.mock("../../src/utils/response", () => ({
  sendSuccess: jest.fn(),
}));

describe("Auth Controller Unit Tests", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    req = {
      body: {},
      headers: {},
      user: {},
    };
    
    // Mock Response object
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Mock Next function
    next = jest.fn();
  });

  describe("register", () => {
    it("should register a user successfully and return 201", async () => {
      // Setup request
      req.headers.authorization = "Bearer valid_token";
      req.body = { email: "test@test.com", username: "testuser" };

      // Mock Firebase
      mockVerifyIdToken.mockResolvedValue({
        uid: "firebase_uid_123",
        firebase: { sign_in_provider: "google.com" },
      });

      // Mock Service
      const mockCreatedUser = { id: "1", email: "test@test.com", username: "testuser" };
      authService.registerUser.mockResolvedValue(mockCreatedUser);

      // Execute Controller
      await register(req, res, next);

      // Assertions
      expect(mockVerifyIdToken).toHaveBeenCalledWith("valid_token");
      expect(authService.registerUser).toHaveBeenCalledWith({
        firebaseUid: "firebase_uid_123",
        email: "test@test.com",
        username: "testuser",
        displayName: undefined,
        avatarUrl: undefined,
      });
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        statusCode: 201,
        message: "User registered successfully.",
        data: mockCreatedUser,
      });
      expect(next).not.toHaveBeenCalled(); // No errors
    });

    it("should throw ApiError(401) if no token is provided", async () => {
      req.body = { email: "test@test.com", username: "testuser" };
      // No headers.authorization

      await register(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
      expect(next.mock.calls[0][0].message).toBe("Access denied. No token provided.");
    });

    it("should throw ApiError(400) if email or username is missing", async () => {
      req.headers.authorization = "Bearer valid_token";
      req.body = { email: "test@test.com" }; // Missing username

      mockVerifyIdToken.mockResolvedValue({
        uid: "firebase_uid_123",
        firebase: { sign_in_provider: "google.com" },
      });

      await register(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(400);
      expect(next.mock.calls[0][0].message).toBe("Email and username are required.");
    });
  });

  describe("sync", () => {
    it("should sync user successfully and return 200", async () => {
      req.headers.authorization = "Bearer valid_token";

      mockVerifyIdToken.mockResolvedValue({
        uid: "firebase_uid_123",
        firebase: { sign_in_provider: "google.com" },
      });

      const mockSyncedUser = { id: "1", firebaseUid: "firebase_uid_123", bannedRecord: null };
      authService.syncUser.mockResolvedValue(mockSyncedUser);

      await sync(req, res, next);

      expect(authService.syncUser).toHaveBeenCalledWith("firebase_uid_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        message: "User synced successfully.",
        data: mockSyncedUser,
      });
    });

    it("should throw ApiError(403) if user is banned", async () => {
      req.headers.authorization = "Bearer valid_token";

      mockVerifyIdToken.mockResolvedValue({ uid: "firebase_uid_123" });

      const mockBannedUser = { 
        id: "1", 
        bannedRecord: { reason: "Spamming" } 
      };
      authService.syncUser.mockResolvedValue(mockBannedUser);

      await sync(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(403);
      expect(next.mock.calls[0][0].message).toBe("Spamming");
      expect(sendSuccess).not.toHaveBeenCalled();
    });
  });

  describe("getMe", () => {
    it("should return the user profile from req.user", async () => {
      // The authenticate middleware is responsible for populating req.user
      const mockUser = { id: "1", username: "testuser" };
      req.user = mockUser;

      await getMe(req, res, next);

      expect(sendSuccess).toHaveBeenCalledWith(res, {
        message: "User profile retrieved.",
        data: mockUser,
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
