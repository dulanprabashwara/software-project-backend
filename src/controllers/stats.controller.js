const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const statsService = require("../services/stats.service");

/**
 * GET /api/v1/stats
 * Get current user's stats.
 */
const getMyStats = asyncHandler(async (req, res) => {
  const stats = await statsService.getUserStats(req.user.id);

  sendSuccess(res, { data: stats });
});

/**
 * GET /api/v1/stats/:userId
 * Get a specific user's stats.
 */
const getUserStats = asyncHandler(async (req, res) => {
  const stats = await statsService.getUserStats(req.params.userId);

  sendSuccess(res, { data: stats });
});

/**
 * POST /api/v1/stats/recalculate
 * Recalculate current user's stats.
 */
const recalculate = asyncHandler(async (req, res) => {
  const stats = await statsService.recalculateUserStats(req.user.id);

  sendSuccess(res, { message: "Stats recalculated.", data: stats });
});

/**
 * GET /api/v1/stats/top-articles
 * Get current user's top performing articles.
 */
const getTopArticles = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  const articles = await statsService.getTopPerformingArticles(
    req.user.id,
    limit,
  );

  sendSuccess(res, { data: articles });
});

/**
 * GET /api/v1/stats/analytics
 * Get article analytics for current user.
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await statsService.getArticleAnalytics(req.user.id);

  sendSuccess(res, { data: analytics });
});

module.exports = {
  getMyStats,
  getUserStats,
  recalculate,
  getTopArticles,
  getAnalytics,
};
