const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

// ─── Dashboard ──────────────────────────────

/**
 * Get or create the admin dashboard singleton.
 */
const getDashboard = async () => {
  let dashboard = await prisma.adminDashboard.findUnique({
    where: { id: "singleton" },
  });

  if (!dashboard) {
    dashboard = await prisma.adminDashboard.create({
      data: { id: "singleton" },
    });
  }

  return dashboard;
};

/**
 * Refresh (recalculate) dashboard data from real counts.
 */
const refreshDashboard = async () => {
  const [totalUsers, totalArticles, premiumUsers] = await Promise.all([
    prisma.user.count(),
    prisma.article.count({ where: { status: "PUBLISHED" } }),
    prisma.user.count({ where: { isPremium: true } }),
  ]);

  const dashboard = await prisma.adminDashboard.upsert({
    where: { id: "singleton" },
    update: { totalUsers, totalArticles, premiumUsers },
    create: { id: "singleton", totalUsers, totalArticles, premiumUsers },
  });

  return dashboard;
};

// ─── User Management ────────────────────────

/**
 * List all users with pagination and filtering.
 */
const listUsers = async ({ page = 1, limit = 20, role, isPremium, search }) => {
  const skip = (page - 1) * limit;
  const where = {};

  if (role) where.role = role;
  if (isPremium !== undefined) where.isPremium = isPremium;
  if (search) {
    where.OR = [
      { username: { contains: search, mode: Prisma.QueryMode.insensitive } },
      { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
      { displayName: { contains: search, mode: Prisma.QueryMode.insensitive } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        isPremium: true,
        isOnline: true,
        createdAt: true,
        bannedRecord: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
};

/**
 * Update a user's role (promote/demote).
 */
const updateUserRole = async (adminId, targetUserId, newRole) => {
  if (adminId === targetUserId) {
    throw ApiError.badRequest("You cannot change your own role.");
  }

  const user = await prisma.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      adminId,
      action: "UPDATE_ROLE",
      targetId: targetUserId,
      targetType: "User",
      details: JSON.stringify({ newRole }),
    },
  });

  return user;
};

/**
 * Toggle premium status for a user.
 */
const togglePremium = async (adminId, targetUserId) => {
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw ApiError.notFound("User not found.");

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { isPremium: !user.isPremium },
  });

  await prisma.auditLog.create({
    data: {
      adminId,
      action: updated.isPremium ? "GRANT_PREMIUM" : "REVOKE_PREMIUM",
      targetId: targetUserId,
      targetType: "User",
    },
  });

  return updated;
};

// ─── Ban Management ─────────────────────────

/**
 * Ban a user.
 */
const banUser = async (adminId, targetUserId, reason, bannedUntil = null) => {
  if (adminId === targetUserId) {
    throw ApiError.badRequest("You cannot ban yourself.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { bannedRecord: true },
  });

  if (!targetUser) throw ApiError.notFound("User not found.");
  if (targetUser.role === "ADMIN")
    throw ApiError.forbidden("Cannot ban an admin.");
  if (targetUser.bannedRecord)
    throw ApiError.conflict("User is already banned.");

  const ban = await prisma.bannedUser.create({
    data: {
      userId: targetUserId,
      bannedById: adminId,
      reason,
      bannedUntil: bannedUntil ? new Date(bannedUntil) : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      adminId,
      action: "BAN_USER",
      targetId: targetUserId,
      targetType: "User",
      details: JSON.stringify({ reason, bannedUntil }),
    },
  });

  return ban;
};

/**
 * Unban a user.
 */
const unbanUser = async (adminId, targetUserId) => {
  const ban = await prisma.bannedUser.findUnique({
    where: { userId: targetUserId },
  });

  if (!ban) throw ApiError.notFound("User is not banned.");

  await prisma.bannedUser.delete({ where: { userId: targetUserId } });

  await prisma.auditLog.create({
    data: {
      adminId,
      action: "UNBAN_USER",
      targetId: targetUserId,
      targetType: "User",
    },
  });

  return { unbanned: true };
};

// ─── Content Moderation ─────────────────────

/**
 * Get reported articles.
 */
const getReports = async ({ page = 1, limit = 20, status }) => {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status;

  const [reports, total] = await Promise.all([
    prisma.reportedArticle.findMany({
      where,
      include: {
        article: {
          select: { id: true, title: true, slug: true },
        },
        reporter: {
          select: { id: true, username: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.reportedArticle.count({ where }),
  ]);

  return { reports, total };
};

/**
 * Report an article.
 */
const reportArticle = async (reporterId, articleId, reason, details = null) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");

  const report = await prisma.reportedArticle.create({
    data: {
      reporterId,
      articleId,
      reason,
      details,
    },
  });

  return report;
};

/**
 * Resolve a report.
 */
const resolveReport = async (adminId, reportId, newStatus) => {
  const report = await prisma.reportedArticle.update({
    where: { id: reportId },
    data: {
      status: newStatus,
      resolvedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      adminId,
      action: "RESOLVE_REPORT",
      targetId: reportId,
      targetType: "ReportedArticle",
      details: JSON.stringify({ newStatus }),
    },
  });

  return report;
};

// ─── Audit Logs ─────────────────────────────

/**
 * Get audit logs with pagination.
 */
const getAuditLogs = async ({ page = 1, limit = 50, adminId, action }) => {
  const skip = (page - 1) * limit;
  const where = {};
  if (adminId) where.adminId = adminId;
  if (action) where.action = action;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        admin: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
};

// ─── AI Config ──────────────────────────────

/**
 * Get AI configuration.
 */
const getAiConfig = async () => {
  let config = await prisma.aiConfig.findUnique({ where: { id: "singleton" } });

  if (!config) {
    config = await prisma.aiConfig.create({ data: { id: "singleton" } });
  }

  return config;
};

/**
 * Update AI configuration.
 */
const updateAiConfig = async (adminId, data) => {
  const { modelName, apiUsageLimit, isEnabled } = data;

  const config = await prisma.aiConfig.upsert({
    where: { id: "singleton" },
    update: {
      ...(modelName && { modelName }),
      ...(apiUsageLimit !== undefined && { apiUsageLimit }),
      ...(isEnabled !== undefined && { isEnabled }),
    },
    create: { id: "singleton", ...data },
  });

  await prisma.auditLog.create({
    data: {
      adminId,
      action: "UPDATE_AI_CONFIG",
      targetId: "singleton",
      targetType: "AiConfig",
      details: JSON.stringify(data),
    },
  });

  return config;
};

// ─── Trending ───────────────────────────────

/**
 * Get trending topics.
 */
const getTrendingTopics = async (limit = 20) => {
  return prisma.trendingTopic.findMany({
    orderBy: { hitCount: "desc" },
    take: limit,
  });
};

/**
 * Increment hit count for a topic (called when articles are viewed by tag).
 */
const incrementTopicHit = async (topicName) => {
  await prisma.trendingTopic.upsert({
    where: { name: topicName.toLowerCase() },
    update: { hitCount: { increment: 1 } },
    create: { name: topicName.toLowerCase(), hitCount: 1 },
  });
};

module.exports = {
  getDashboard,
  refreshDashboard,
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
  incrementTopicHit,
};
