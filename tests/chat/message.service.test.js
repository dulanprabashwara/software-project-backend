// tests/chat/message.service.test.js
const { getConversation, getConversationList, markAsRead, getUnreadCount } = require("../../src/services/message.service");
const prisma = require("../../src/config/prisma");

jest.mock("../../src/config/prisma", () => require("../mocks/prisma.mock"));

describe("Message Service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getConversation", () => {
    test("should return messages between two users and total count", async () => {
      const mockMessages = [{ id: "msg-1", content: "hello" }];
      prisma.message.findMany.mockResolvedValue(mockMessages);
      prisma.message.count.mockResolvedValue(1);

      const result = await getConversation("user-1", "user-2", 1, 50);

      expect(prisma.message.findMany).toHaveBeenCalled();
      expect(prisma.message.count).toHaveBeenCalled();
      // messages array is reversed in the service
      expect(result.messages).toEqual([{ id: "msg-1", content: "hello" }]);
      expect(result.total).toBe(1);
    });
  });

  describe("getConversationList", () => {
    test("should return a list of conversations for the user", async () => {
      prisma.message.findMany
        .mockResolvedValueOnce([{ receiverId: "user-2" }]) // sent
        .mockResolvedValueOnce([{ senderId: "user-3" }]);  // received
        
      prisma.message.findFirst.mockResolvedValue({ id: "msg-x", sentAt: "2026-05-01T00:00:00Z" });
      prisma.message.count.mockResolvedValue(2);
      prisma.user.findUnique.mockResolvedValue({ id: "user-2", username: "bob" });

      const result = await getConversationList("user-1");

      expect(prisma.message.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.message.findFirst).toHaveBeenCalledTimes(2); // one for user-2, one for user-3
      expect(result.length).toBe(2);
      expect(result[0].unreadCount).toBe(2);
      expect(result[0].user.username).toBe("bob");
    });
  });

  describe("markAsRead", () => {
    test("should update many messages to read status", async () => {
      prisma.message.updateMany.mockResolvedValue({ count: 5 });

      await markAsRead("user-1", "user-2");

      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: { senderId: "user-2", receiverId: "user-1", isRead: false },
        data: { isRead: true },
      });
    });
  });

  describe("getUnreadCount", () => {
    test("should return count of all unread messages for a user", async () => {
      prisma.message.count.mockResolvedValue(10);

      const count = await getUnreadCount("user-1");

      expect(prisma.message.count).toHaveBeenCalledWith({
        where: { receiverId: "user-1", isRead: false },
      });
      expect(count).toBe(10);
    });
  });
});
