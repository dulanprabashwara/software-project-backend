const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const adminService = require("../services/admin.service");
const { parsePagination } = require("../utils/helpers");

// ─── Dashboard ──────────────────────────────

const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await adminService.refreshDashboard();
  sendSuccess(res, { data: dashboard });
});

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

const updateUserRole = asyncHandler(async (req, res) => {
  const user = await adminService.updateUserRole(
    req.user.id,
    req.params.userId,
    req.body.role,
  );
  sendSuccess(res, { message: "User role updated.", data: user });
});

const togglePremium = asyncHandler(async (req, res) => {
  const user = await adminService.togglePremium(req.user.id, req.params.userId);
  sendSuccess(res, {
    message: user.isPremium ? "Premium granted." : "Premium revoked.",
    data: user,
  });
});

// ─── Bans ───────────────────────────────────

const banUser = asyncHandler(async (req, res) => {
  const { reason, bannedUntil } = req.body;
  const ban = await adminService.banUser(
    req.user.id,
    req.params.userId,
    reason,
    bannedUntil,
  );
  sendSuccess(res, { statusCode: 201, message: "User banned.", data: ban });
});

const unbanUser = asyncHandler(async (req, res) => {
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

const reportArticle = asyncHandler(async (req, res) => {
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

const resolveReport = asyncHandler(async (req, res) => {
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

const updateAiConfig = asyncHandler(async (req, res) => {
  const config = await adminService.updateAiConfig(req.user.id, req.body);
  sendSuccess(res, { message: "AI config updated.", data: config });
});

// ─── Trending ───────────────────────────────

const getTrendingTopics = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const topics = await adminService.getTrendingTopics(limit);
  sendSuccess(res, { data: topics });
});

module.exports = {
  getDashboard,
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
};
