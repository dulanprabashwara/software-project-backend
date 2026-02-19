const { Router } = require("express");

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const articleRoutes = require("./article.routes");
const commentRoutes = require("./comment.routes");
const storyRoutes = require("./story.routes");
const messageRoutes = require("./message.routes");
const statsRoutes = require("./stats.routes");
const libraryRoutes = require("./library.routes");
const feedRoutes = require("./feed.routes");
const notificationRoutes = require("./notification.routes");
const adminRoutes = require("./admin.routes");

const router = Router();

// ─── API Routes ─────────────────────────────
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/articles", articleRoutes);
router.use("/comments", commentRoutes);
router.use("/stories", storyRoutes);
router.use("/messages", messageRoutes);
router.use("/stats", statsRoutes);
router.use("/library", libraryRoutes);
router.use("/feed", feedRoutes);
router.use("/notifications", notificationRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
