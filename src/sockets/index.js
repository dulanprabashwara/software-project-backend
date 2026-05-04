const { Server } = require("socket.io");
const admin = require("../config/firebase");
const prisma = require("../config/prisma");

/**
 * Initialize Socket.IO on the HTTP server.
 *
 * Handles:
 * - Authentication via Firebase ID tokens
 * - Online/offline status management
 * - Private messaging
 * - Typing indicators
 * - Notification broadcasting
 *
 * @param {import("http").Server} httpServer
 * @returns {Server}
 */
const initializeSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: [process.env.CLIENT_URL, "http://localhost:3000", "http://127.0.0.1:3000"].filter(Boolean),
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Authentication middleware for Socket.IO ──
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decodedToken = await admin.auth().verifyIdToken(token);
      const user = await prisma.user.findUnique({
        where: { firebaseUid: decodedToken.uid },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      });

      if (!user) {
        return next(new Error("User not found"));
      }

      socket.data.userId = user.id;
      socket.data.userData = user;
      next();
    } catch (error) {
      console.error("Socket auth error:", error.message);
      next(new Error("Invalid token"));
    }
  });

  // Track active connection counts per user to prevent React Strict Mode / hot-reloads race conditions
  const userConnections = new Map();
  const offlineTimeouts = new Map();

  // ── Connection handler ──
  io.on("connection", async (socket) => {
    console.log(
      `⚡ User connected: ${socket.data.userData.username} (${socket.data.userId})`,
    );

    // Join a personal room for targeted messages
    socket.join(`user:${socket.data.userId}`);

    const userId = socket.data.userId;
    const currentCount = userConnections.get(userId) || 0;
    userConnections.set(userId, currentCount + 1);

    // Cancel any pending offline timeout
    if (offlineTimeouts.has(userId)) {
      clearTimeout(offlineTimeouts.get(userId));
      offlineTimeouts.delete(userId);
    }

    if (currentCount === 0) {
      // First connection, mark user as online
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: true, lastSeen: new Date() },
      });

      // Broadcast online status to followers
      socket.broadcast.emit("user:online", {
        userId,
        username: socket.data.userData.username,
      });
    }

    // ── Private message ──
    socket.on("message:send", async (data, callback) => {
      try {
        const { receiverId, content } = data;

        if (!receiverId || !content?.trim()) {
          return callback?.({ error: "Receiver ID and content are required" });
        }

        // --- SECURITY ENFORCEMENT 1: Follow or Prior History ---
        // Check if the sender follows the receiver OR if they have prior chat history
        const isFollowing = await prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: socket.data.userId,
              followingId: receiverId,
            },
          },
        });

        let canMessage = !!isFollowing;

        if (!canMessage) {
          // Check for prior message history between the two users
          const priorMessage = await prisma.message.findFirst({
            where: {
              OR: [
                { senderId: socket.data.userId, receiverId },
                { senderId: receiverId, receiverId: socket.data.userId },
              ],
            },
            select: { id: true }, // we only need to know it exists
          });
          if (priorMessage) {
            canMessage = true;
          }
        }

        if (!canMessage) {
          return callback?.({
            error: "You can only start conversations with users you follow.",
          });
        }
        // -----------------------------------------------------

        // Save message to database
        const message = await prisma.message.create({
          data: {
            content: content.trim(),
            senderId: socket.data.userId,
            receiverId,
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        });

        // Send to receiver in real time
        io.to(`user:${receiverId}`).emit("message:receive", message);

        // Acknowledge to sender
        callback?.({ success: true, message });
      } catch (error) {
        console.error("Message send error:", error.message);
        callback?.({ error: "Failed to send message" });
      }
    });

    // ── Delete Message ──
    socket.on("message:delete", async (data, callback) => {
      try {
        const { messageId } = data;

        if (!messageId) {
          return callback?.({ error: "Message ID is required" });
        }

        // Find the message
        const message = await prisma.message.findUnique({
          where: { id: messageId },
        });

        if (!message) {
          return callback?.({ error: "Message not found" });
        }

        // --- SECURITY ENFORCEMENT 2: Only Sender can Delete ---
        if (message.senderId !== socket.data.userId) {
          return callback?.({
            error: "Unauthorized: You can only delete messages you sent.",
          });
        }
        // ------------------------------------------------------

        await prisma.message.delete({
          where: { id: messageId },
        });

        // Notify both sender and receiver that a message was deleted so their UI can remove it
        io.to(`user:${message.senderId}`).emit("message:deleted", {
          messageId,
        });
        io.to(`user:${message.receiverId}`).emit("message:deleted", {
          messageId,
        });

        callback?.({ success: true });
      } catch (error) {
        console.error("Message delete error:", error.message);
        callback?.({ error: "Failed to delete message" });
      }
    });

    // ── Mark messages as read ──
    socket.on("message:read", async (data) => {
      try {
        const { messageIds, senderId } = data;

        if (!messageIds?.length) return;

        await prisma.message.updateMany({
          where: {
            id: { in: messageIds },
            receiverId: socket.data.userId,
          },
          data: { isRead: true },
        });

        // Notify the sender that their messages were read
        io.to(`user:${senderId}`).emit("message:read", {
          messageIds,
          readBy: socket.data.userId,
        });
      } catch (error) {
        console.error("Message read error:", error.message);
      }
    });

    // ── Typing indicator ──
    socket.on("typing:start", (data) => {
      io.to(`user:${data.receiverId}`).emit("typing:start", {
        userId: socket.data.userId,
        username: socket.data.userData.username,
      });
    });

    socket.on("typing:stop", (data) => {
      io.to(`user:${data.receiverId}`).emit("typing:stop", {
        userId: socket.data.userId,
      });
    });

    // ── Disconnect ──
    socket.on("disconnect", async () => {
      console.log(`💤 User disconnected: ${socket.data.userData.username}`);
      
      const userId = socket.data.userId;
      let count = userConnections.get(userId) || 0;
      count = Math.max(0, count - 1);

      if (count === 0) {
        userConnections.delete(userId);

        // Wait 4 seconds to allow reconnects during page reloads/React Strict Mode
        const timeout = setTimeout(async () => {
          if (!userConnections.has(userId)) {
            try {
              await prisma.user.update({
                where: { id: userId },
                data: { isOnline: false, lastSeen: new Date() },
              });
              socket.broadcast.emit("user:offline", { userId });
            } catch (err) {
              console.error("Failed to mark user offline:", err.message);
            }
          }
          offlineTimeouts.delete(userId);
        }, 4000);

        offlineTimeouts.set(userId, timeout);
      } else {
        userConnections.set(userId, count);
      }
    });
  });

  return io;
};

module.exports = initializeSocket;
