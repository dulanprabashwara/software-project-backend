// @ts-nocheck
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const adminService = require("../services/admin.service");
const { parsePagination } = require("../utils/helpers");
const { excludedKeywords } = require('../config/excludedKeywords');

// ─── Dashboard ──────────────────────────────

const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await adminService.refreshDashboard();
  sendSuccess(res, { data: dashboard });
});

const getEngagementAnalytics = async (req, res, next) => {
  try {
    // Grab the '?days=' from the URL (default to 30 if not provided)
    const days = parseInt(req.query.days) || 30; 

    // Call the service
    const chartData = await adminService.calculateEngagement(days);

    res.status(200).json({
      success: true,
      data: chartData 
    });
  } catch (error) {
    next(error);
  }
};

// ─── Users ──────────────────────────────────

const listUsers = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { role, isPremium, search } = req.query;

  const { users, total } = await adminService.listUsers({
    page,
    limit,
    role,
    isPremium:
      isPremium === "true" ? true : isPremium === "false" ? false : undefined,
    search,
  });

  sendPaginated(res, { data: users, page, limit, total });
});

const updateUserRole = asyncHandler(async (/** @type {any} */ req, res) => {
  const user = await adminService.updateUserRole(
    req.user.id,
    req.params.userId,
    req.body.role,
  );
  sendSuccess(res, { message: "User role updated.", data: user });
});

const togglePremium = asyncHandler(async (/** @type {any} */ req, res) => {
  const user = await adminService.togglePremium(req.user.id, req.params.userId);
  sendSuccess(res, {
    message: user.isPremium ? "Premium granted." : "Premium revoked.",
    data: user,
  });
});

// ─── Bans ───────────────────────────────────

const banUser = asyncHandler(async (/** @type {any} */ req, res) => {
  const { reason, bannedUntil } = req.body;
  const ban = await adminService.banUser(
    req.user.id,
    req.params.userId,
    reason,
    bannedUntil,
  );
  sendSuccess(res, { statusCode: 201, message: "User banned.", data: ban });
});

const unbanUser = asyncHandler(async (/** @type {any} */ req, res) => {
  await adminService.unbanUser(req.user.id, req.params.userId);
  sendSuccess(res, { message: "User unbanned." });
});

// ─── Reports ────────────────────────────────

const getReports = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { status } = req.query;
  const { reports, total } = await adminService.getReports({
    page,
    limit,
    status,
  });
  sendPaginated(res, { data: reports, page, limit, total });
});

const reportArticle = asyncHandler(async (/** @type {any} */ req, res) => {
  const { reason, details } = req.body;
  const report = await adminService.reportArticle(
    req.user.id,
    req.params.articleId,
    reason,
    details,
  );
  sendSuccess(res, {
    statusCode: 201,
    message: "Article reported.",
    data: report,
  });
});

const resolveReport = asyncHandler(async (/** @type {any} */ req, res) => {
  const report = await adminService.resolveReport(
    req.user.id,
    req.params.reportId,
    req.body.status,
  );
  sendSuccess(res, { message: "Report resolved.", data: report });
});

// ─── Audit Logs ─────────────────────────────

const getAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { adminId, action } = req.query;
  const { logs, total } = await adminService.getAuditLogs({
    page,
    limit,
    adminId,
    action,
  });
  sendPaginated(res, { data: logs, page, limit, total });
});

// ─── AI Config ──────────────────────────────

const getAiConfig = asyncHandler(async (req, res) => {
  const config = await adminService.getAiConfig();
  sendSuccess(res, { data: config });
});

const updateAiConfig = asyncHandler(async (/** @type {any} */ req, res) => {
  const config = await adminService.updateAiConfig(req.user.id, req.body);
  sendSuccess(res, { message: "AI config updated.", data: config });
});

// ─── Trending ───────────────────────────────

const getTrendingTopics = asyncHandler(async (/** @type {any} */ req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const topics = await adminService.getTrendingTopics(limit);
  sendSuccess(res, { data: topics });
});

// ─── Offers ───────────────────────────────
const getOffers = asyncHandler(async (/** @type {any} */ req, res, next) => {
  try {
    // Assuming adminService is already imported at the top of this file
    const offers = await adminService.getAllOffers();
    res.status(200).json({ success: true, data: offers });
  } catch (error) {
    next(error); // Passes the error to your teammate's error handler
  }
});

const createOffer = asyncHandler(async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const newOffer = await adminService.createOffer(req.body, adminId);
    res.status(201).json({ success: true, data: newOffer });
  } catch (error) {
    next(error);
  }
});

const updateOffer = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params; // Grabs the ID from the URL
    const adminId = req.user.id;
    const updatedOffer = await adminService.updateOffer(id, req.body,adminId);
    res.status(200).json({ success: true, data: updatedOffer });
  } catch (error) {
    next(error);
  }
});

// ─── scraping sources ───────────────────────────────
const getScrapingSources = asyncHandler(async (req, res, next) => {
  try {
    const sources = await adminService.getScrapingSources();
    res.status(200).json({ success: true, data: sources });
  } catch (error) {
    next(error);
  }
});

const createScrapingSource = asyncHandler(async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const newSource = await adminService.createScrapingSource(req.body,adminId);
    res.status(201).json({ success: true, data: newSource });
  } catch (error) {
    next(error);
  }
});

const updateScrapingSource = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const updatedSource = await adminService.updateScrapingSource(id, req.body,adminId);
    res.status(200).json({ success: true, data: updatedSource });
  } catch (error) {
    next(error);
  }
});

const deleteScrapingSource = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    await adminService.deleteScrapingSource(id);
    res.status(200).json({ success: true, message: "Source deleted successfully" });
  } catch (error) {
    next(error);
  }
});

const getDefaultKeywords = asyncHandler(async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: excludedKeywords });
  } catch (error) {
    next(error);
  }
});

//  ─── URL validation ───────────────────────────────
const validateUrl = asyncHandler(async (req, res, next) => {
  try {
    const { url } = req.body;
    
    // Ensure it has https:// so the fetch doesn't crash
    const formattedUrl = url.startsWith('http') ? url : `https://${url}`;

    // Ping the website- Pretending to be a normal web browser
    const response = await fetch(formattedUrl, { 
      method: 'GET',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
      } 
    });

    // If the website returns a 200 OK status, it is real and scrapable!
    if (response.ok) {
      return res.status(200).json({ success: true, data: { valid: true } });
    } else {
      // It exists, but it blocked us or returned a 404
      return res.status(200).json({ success: true, data: { valid: false } });
    }
  } catch (error) {
    // The domain doesn't exist at all, or the site is completely down
    return res.status(200).json({ success: true, data: { valid: false } });
  }
});

const getAdminMetrics = async (req, res) => {
  try {
    const currentUserId = req.user.id; 

    const totalActions = await prisma.auditLog.count({
      where: { 
        adminId: currentUserId 
      }
    });

    const totalResolved = await prisma.auditLog.count({
      where: {
        adminId: currentUserId,
        action: {
          contains: 'RESOLVE', 
          mode: 'insensitive'
        }
      }
    });

    // Send back just the two tiny numbers
    return res.status(200).json({ 
      success: true, 
      data: { totalActions, totalResolved } 
    });

  } catch (error) {
    console.error("Error fetching admin metrics:", error);
    return res.status(500).json({ success: false, message: "Failed to load metrics" });
  }
};

module.exports = {
  getDashboard,
  getEngagementAnalytics,
  listUsers,
  updateUserRole,
  togglePremium,
  banUser,
  unbanUser,
  getReports,
  reportArticle,
  resolveReport,
  getAuditLogs,
  getAiConfig,
  updateAiConfig,
  getTrendingTopics,
  getOffers,
  createOffer,
  updateOffer,
  getScrapingSources,
  createScrapingSource,
  validateUrl,
  updateScrapingSource,
  deleteScrapingSource,
  getDefaultKeywords,
  getAdminMetrics,
};
