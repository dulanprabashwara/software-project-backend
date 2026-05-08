const { 
  getConversations, 
  getConversation, 
  markAsRead, 
  getUnreadCount 
} = require("../../src/controllers/message.controller");
const messageService = require("../../src/services/message.service");
const { sendSuccess, sendPaginated } = require("../../src/utils/response");

// Mock dependencies
jest.mock("../../src/services/message.service");
jest.mock("../../src/utils/response", () => ({
  sendSuccess: jest.fn(),
  sendPaginated: jest.fn(),
}));

describe("Message Controller Unit Tests", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      params: {},
      query: {},
      user: { id: "user_123" },
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    next = jest.fn();
  });

  describe("getConversations", () => {
    it("should return list of conversations", async () => {
      const mockConversations = [{ otherUser: { id: "user_456" } }];
      messageService.getConversationList.mockResolvedValue(mockConversations);

      await getConversations(req, res, next);

      expect(messageService.getConversationList).toHaveBeenCalledWith("user_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        message: "Conversations retrieved.",
        data: mockConversations,
      });
    });
  });

  describe("getConversation", () => {
    it("should return paginated messages", async () => {
      req.params.userId = "user_456";
      req.query = { page: "1", limit: "10" };
      
      const mockMessages = [{ id: "msg_1", content: "hello" }];
      messageService.getConversation.mockResolvedValue({ messages: mockMessages, total: 1 });

      await getConversation(req, res, next);

      expect(messageService.getConversation).toHaveBeenCalledWith("user_123", "user_456", 1, 10);
      expect(sendPaginated).toHaveBeenCalledWith(res, {
        data: mockMessages,
        page: 1,
        limit: 10,
        total: 1,
        message: "Messages retrieved.",
      });
    });
  });

  describe("markAsRead", () => {
    it("should mark messages as read", async () => {
      req.params.userId = "user_456";
      messageService.markAsRead.mockResolvedValue();

      await markAsRead(req, res, next);

      expect(messageService.markAsRead).toHaveBeenCalledWith("user_123", "user_456");
      expect(sendSuccess).toHaveBeenCalledWith(res, { message: "Messages marked as read." });
    });
  });

  describe("getUnreadCount", () => {
    it("should return total unread count", async () => {
      messageService.getUnreadCount.mockResolvedValue(5);

      await getUnreadCount(req, res, next);

      expect(messageService.getUnreadCount).toHaveBeenCalledWith("user_123");
      expect(sendSuccess).toHaveBeenCalledWith(res, { data: { unreadCount: 5 } });
    });
  });
});
