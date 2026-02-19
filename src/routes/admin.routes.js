const { Router } = require("express");
const adminController = require("../controllers/admin.controller");
const { authenticate, authorize } = require("../middlewares/auth");

const router = Router();

// All admin routes require authentication + ADMIN role
router.use(authenticate, authorize("ADMIN"));

// Dashboard
router.get("/dashboard", adminController.getDashboard);

// User management
router.get("/users", adminController.listUsers);
router.put("/users/:userId/role", adminController.updateUserRole);
router.put("/users/:userId/premium", adminController.togglePremium);
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

module.exports = router;
