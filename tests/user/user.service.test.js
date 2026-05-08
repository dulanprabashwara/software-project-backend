// tests/user/user.service.test.js
const { getUserProfile, updateProfile, searchUsers, deleteAccount } = require("../../src/services/user.service");
const prisma = require("../../src/config/prisma");
const admin = require("../../src/config/firebase");
const ApiError = require("../../src/utils/ApiError");

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

jest.mock("../../src/config/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    deleteUser: jest.fn(),
  }),
}));

describe("User Service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getUserProfile", () => {
    test("should fetch user by username and return formatted profile", async () => {
      const mockUser = {
        id: "user-1",
        username: "testuser",
        _count: { sentMessages: 5, receivedMessages: 2 },
        followers: [{ id: "follower-1" }],
      };
      
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.message.count.mockResolvedValue(3);

      const result = await getUserProfile("testuser", "current-user-id");

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { username: "testuser" } })
      );
      expect(prisma.message.count).toHaveBeenCalledWith({
        where: { receiverId: "user-1", isRead: false },
      });
      
      expect(result.unreadMessageCount).toBe(3);
      expect(result.isFollowing).toBe(true);
      expect(result._count.sentMessages).toBeUndefined(); // ensure cleanup happened
    });

    test("should throw NotFound if user does not exist", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(getUserProfile("unknown")).rejects.toThrow(ApiError);
      await expect(getUserProfile("unknown")).rejects.toHaveProperty("message", "User not found.");
    });
  });

  describe("updateProfile", () => {
    test("should update user details successfully", async () => {
      prisma.user.findFirst.mockResolvedValue(null); // username not taken
      prisma.user.update.mockResolvedValue({ id: "user-1", displayName: "New Name" });

      const result = await updateProfile("user-1", { displayName: "New Name", username: "new_username" });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { username: "new_username", NOT: { id: "user-1" } },
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: expect.objectContaining({ displayName: "New Name", username: "new_username" })
        })
      );
      expect(result.displayName).toBe("New Name");
    });

    test("should throw conflict if new username is already taken", async () => {
      prisma.user.findFirst.mockResolvedValue({ id: "user-other", username: "taken" });

      await expect(updateProfile("user-1", { username: "taken" })).rejects.toThrow("Username already taken.");
    });
  });

  describe("searchUsers", () => {
    test("should return users and total count", async () => {
      const mockUsers = [{ id: "1", username: "john" }];
      prisma.user.findMany.mockResolvedValue(mockUsers);
      prisma.user.count.mockResolvedValue(1);

      const result = await searchUsers("john", 1, 10);

      expect(result.users).toEqual(mockUsers);
      expect(result.total).toBe(1);
      expect(prisma.user.findMany).toHaveBeenCalled();
      expect(prisma.user.count).toHaveBeenCalled();
    });
  });

  describe("deleteAccount", () => {
    test("should delete subscriptions, audit logs, user row, and firebase auth", async () => {
      prisma.subscription.deleteMany.mockResolvedValue({});
      prisma.auditLog.deleteMany.mockResolvedValue({});
      prisma.user.delete.mockResolvedValue({});
      admin.auth().deleteUser.mockResolvedValue();

      await deleteAccount("user-123", "firebase-123");

      expect(prisma.subscription.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-123" } });
      expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { adminId: "user-123" } });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user-123" } });
      expect(admin.auth().deleteUser).toHaveBeenCalledWith("firebase-123");
    });
  });
});
