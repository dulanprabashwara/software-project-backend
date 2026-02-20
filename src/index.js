require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
/** @type {() => import('express').RequestHandler} */
const helmet = require("helmet").default;
const morgan = require("morgan");

const routes = require("./routes");
const errorHandler = require("./middlewares/errorHandler");
const { apiLimiter } = require("./middlewares/rateLimiter");
const initializeSocket = require("./sockets");
const prisma = require("./config/prisma");

// ─── App Setup ──────────────────────────────

const app = express();
const server = http.createServer(app);

// ─── Socket.IO ──────────────────────────────

const io = initializeSocket(server);

// Make io accessible in route handlers via req.app
app.set("io", io);

// ─── Global Middleware ──────────────────────

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging (skip in test)
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// Rate limiting
app.use("/api/", apiLimiter);

// ─── Health Check ───────────────────────────

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🚀 Easy Blogger API is running",
    version: "1.0.0",
    docs: "/api",
  });
});

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      status: "healthy",
      database: "connected",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: "unhealthy",
      database: "disconnected",
      error: error.message,
    });
  }
});

// ─── API Routes ─────────────────────────────

app.use("/api", routes);

// ─── 404 Handler ────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// ─── Global Error Handler ───────────────────

app.use(errorHandler);

// ─── Start Server ───────────────────────────

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │                                         │
  │   🚀 Easy Blogger API Server            │
  │                                         │
  │   Port:         ${PORT}                    │
  │   Environment:  ${process.env.NODE_ENV || "development"}          │
  │   API Base:     /api                    │
  │   Health:       /health                 │
  │   Socket.IO:    enabled                 │
  │                                         │
  └─────────────────────────────────────────┘
  `);
});

// ─── Graceful Shutdown ──────────────────────

const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    console.log("HTTP server closed.");
    await prisma.$disconnect();
    console.log("Database disconnected.");
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server, io };
