const { getProfile, getMe, updateProfile, searchUsers, deleteAccount } = require("../../src/controllers/user.controller");
const userService = require("../../src/services/user.service");
const prisma = require("../../src/config/prisma");
const { sendSuccess, sendPaginated } = require("../../src/utils/response");

// Mock dependencies
jest.mock("../../src/services/user.service");
jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));
jest.mock("../../src/utils/response", () => ({
  sendSuccess: jest.fn(),
  sendPaginated: jest.fn(),
}));

describe("User Controller Unit Tests", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      params: {},
      query: {},
      body: {},
      user: { id: "user_123", firebaseUid: "fb_123" },
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    next = jest.fn();
  });

  describe("getProfile", () => {
    it("should return the user profile", async () => {
      req.params.identifier = "testuser";
      
      const mockProfile = { id: "user_456", username: "testuser" };
      userService.getUserProfile.mockResolvedValue(mockProfile);

      await getProfile(req, res, next);

      expect(userService.getUserProfile).toHaveBeenCalledWith("testuser", "user_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        message: "User profile retrieved.",
        data: mockProfile,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should pass error to next if service throws", async () => {
      req.params.identifier = "testuser";
      const error = new Error("Not found");
      userService.getUserProfile.mockRejectedValue(error);

      await getProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("getMe", () => {
    it("should return the current user's full profile", async () => {
      const mockProfile = { id: "user_123", username: "currentuser" };
      userService.getUserProfile.mockResolvedValue(mockProfile);
      prisma.user.findUnique.mockResolvedValue({ receiveWeeklyExport: true });

      await getMe(req, res, next);

      expect(userService.getUserProfile).toHaveBeenCalledWith("user_123", "user_123");
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user_123" },
        select: { receiveWeeklyExport: true },
      });
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        message: "Current user profile retrieved.",
        data: { ...mockProfile, receiveWeeklyExport: true },
      });
    });
  });

  describe("updateProfile", () => {
    it("should update the user profile", async () => {
      req.body = { displayName: "New Name" };
      
      const mockUpdatedUser = { id: "user_123", displayName: "New Name" };
      userService.updateProfile.mockResolvedValue(mockUpdatedUser);

      await updateProfile(req, res, next);

      expect(userService.updateProfile).toHaveBeenCalledWith("user_123", { displayName: "New Name" });
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        message: "Profile updated successfully.",
        data: mockUpdatedUser,
      });
    });
  });

  describe("searchUsers", () => {
    it("should search users and return paginated response", async () => {
      req.query = { q: "john", page: "1", limit: "10" };
      
      const mockUsers = [{ id: "1", username: "john_doe" }];
      userService.searchUsers.mockResolvedValue({ users: mockUsers, total: 1 });

      await searchUsers(req, res, next);

      expect(userService.searchUsers).toHaveBeenCalledWith("john", 1, 10);
      expect(sendPaginated).toHaveBeenCalledWith(res, {
        data: mockUsers,
        page: 1,
        limit: 10,
        total: 1,
        message: "Users found.",
      });
    });

    it("should return 400 if search query is too short", async () => {
      req.query = { q: "j" };

      await searchUsers(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Search query must be at least 2 characters.",
      });
      expect(userService.searchUsers).not.toHaveBeenCalled();
    });
  });

  describe("deleteAccount", () => {
    it("should delete the account and return success", async () => {
      userService.deleteAccount.mockResolvedValue();

      await deleteAccount(req, res, next);

      expect(userService.deleteAccount).toHaveBeenCalledWith("user_123", "fb_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        message: "Account deleted successfully.",
      });
    });
  });
});
