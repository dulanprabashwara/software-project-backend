const { Router } = require("express");
const adminController = require("../controllers/admin.controller");
const { authenticate, authorize } = require("../middlewares/auth");

const router = Router();

// @ts-ignore
router.use(authenticate, authorize("ADMIN"));

// Dashboard
router.get("/dashboard", adminController.getDashboard);
router.get('/engagement', authenticate, adminController.getEngagementAnalytics);

// User management
router.get("/users", adminController.listUsers);
router.put("/users/:userId/role", adminController.updateUserRole);
router.post("/users/:userId/ban", adminController.banUser);
router.delete("/users/:userId/ban", adminController.unbanUser);

// Reports / Moderation
router.get("/reports", adminController.getReports);
router.put("/reports/:reportId", adminController.resolveReport);

// Audit logs
router.get("/audit-logs", adminController.getAuditLogs);

// AI Config
router.get("/ai-config", adminController.getAiConfig);
router.put("/ai-config", adminController.updateAiConfig);

// Trending
router.get("/trending", adminController.getTrendingTopics);

// Subscription Offers
router.get("/offers", adminController.getOffers);
router.post("/offers", adminController.createOffer);
router.put("/offers/:id", adminController.updateOffer);

// AI Scraping Sources
router.get("/scraping-sources", adminController.getScrapingSources);
router.post("/scraping-sources", adminController.createScrapingSource);
router.post("/validate-url", adminController.validateUrl);
router.put("/scraping-sources/:id", adminController.updateScrapingSource);
router.delete("/scraping-sources/:id", adminController.deleteScrapingSource);
router.get('/scraping/default-keywords', adminController.getDefaultKeywords);

//profile
router.get('/metrics', authenticate, adminController.getAdminMetrics);
router.put('/profile', adminController.updateAdminProfile);
router.post('/sessions/register', adminController.registerSession); 
router.get('/sessions', adminController.getActiveSessions);
router.delete('/sessions/:sessionId', adminController.revokeSession);

module.exports = router;
