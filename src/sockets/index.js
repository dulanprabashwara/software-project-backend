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
      origin: process.env.CLIENT_URL || "http://localhost:3000",
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

  // ── Connection handler ──
  io.on("connection", async (socket) => {
    console.log(
      `⚡ User connected: ${socket.data.userData.username} (${socket.data.userId})`,
    );

    // Join a personal room for targeted messages
    socket.join(`user:${socket.data.userId}`);

    // Mark user as online
    await prisma.user.update({
      where: { id: socket.data.userId },
      data: { isOnline: true, lastSeen: new Date() },
    });

    // Broadcast online status to followers
    socket.broadcast.emit("user:online", {
      userId: socket.data.userId,
      username: socket.data.userData.username,
    });

    // ── Private message ──
    socket.on("message:send", async (data, callback) => {
      try {
        const { receiverId, content } = data;

        if (!receiverId || !content?.trim()) {
          return callback?.({ error: "Receiver ID and content are required" });
        }

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

      await prisma.user.update({
        where: { id: socket.data.userId },
        data: { isOnline: false, lastSeen: new Date() },
      });

      socket.broadcast.emit("user:offline", {
        userId: socket.data.userId,
      });
    });
  });

  return io;
};

module.exports = initializeSocket;
