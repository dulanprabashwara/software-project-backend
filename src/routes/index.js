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
const aiRoutes = require("./ai.routes");
const paymentRoutes = require("./payment.routes");
const stripeRoutes = require("./stripe.routes");
const scraperRoutes = require("./scraper.routes");
const wordpressRoutes = require("./wordpress.routes");
const searchRoutes       = require("./search.routes"); 
 const homefeedRoutes = require("./homefeed.routes");

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
router.use("/ai", aiRoutes);
router.use("/payments", paymentRoutes);
router.use("/stripe", stripeRoutes);
router.use("/scraper", scraperRoutes);
router.use("/wordpress",  wordpressRoutes);
router.use("/search",     searchRoutes);  
router.use("/homefeed", homefeedRoutes);

module.exports = router;
