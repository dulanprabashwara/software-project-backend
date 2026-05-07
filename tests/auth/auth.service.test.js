// tests/auth/auth.service.test.js
const { registerUser, syncUser } = require("../../src/services/auth.service");
const prisma = require("../../src/config/prisma");
const admin = require("../../src/config/firebase");
const ApiError = require("../../src/utils/ApiError");

// Mock dependencies
jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

jest.mock("../../src/config/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    getUser: jest.fn(),
  }),
}));

describe("Auth Service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("registerUser", () => {
    const validData = {
      firebaseUid: "uid-123",
      email: "test@example.com",
      username: "testuser",
      displayName: "Test User",
    };

    test("should successfully create a new user when no conflicts exist", async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: "user-1", ...validData });

      const result = await registerUser(validData);

      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(result.username).toBe("testuser");
    });

    test("should throw conflict if firebaseUid already exists", async () => {
      prisma.user.findFirst.mockResolvedValue({ firebaseUid: "uid-123" });

      await expect(registerUser(validData)).rejects.toThrow(ApiError);
      await expect(registerUser(validData)).rejects.toHaveProperty("message", "User already registered.");
    });

    test("should throw conflict if email already exists", async () => {
      prisma.user.findFirst.mockResolvedValue({ firebaseUid: "other", email: "test@example.com" });

      await expect(registerUser(validData)).rejects.toThrow("Email already in use.");
    });

    test("should throw conflict if username already exists", async () => {
      prisma.user.findFirst.mockResolvedValue({ firebaseUid: "other", email: "other@ext.com", username: "testuser" });

      await expect(registerUser(validData)).rejects.toThrow("Username already taken.");
    });
  });

  describe("syncUser", () => {
    const firebaseUid = "uid-456";

    test("should return existing user if found in database", async () => {
      const mockUser = { id: "user-2", firebaseUid };
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await syncUser(firebaseUid);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { firebaseUid },
        include: expect.any(Object),
      });
      expect(admin.auth().getUser).not.toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    test("should auto-create user fetching data from firebase if not found in db", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      
      const mockFirebaseUser = {
        email: "new@google.com",
        displayName: "New Google User",
        photoURL: "http://photo.url",
      };
      admin.auth().getUser.mockResolvedValue(mockFirebaseUser);
      
      prisma.user.create.mockResolvedValue({
        id: "user-3",
        firebaseUid,
        email: "new@google.com",
      });

      const result = await syncUser(firebaseUid);

      expect(admin.auth().getUser).toHaveBeenCalledWith(firebaseUid);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(result.email).toBe("new@google.com");
    });
  });
});
