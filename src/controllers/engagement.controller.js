const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const engagementService = require("../services/engagement.service");
const { parsePagination } = require("../utils/helpers");

/**
 * POST /api/v1/articles/:articleId/like
 * Toggle like on an article.
 */
const toggleLike = asyncHandler(async (req, res) => {
  const result = await engagementService.toggleLike(
    req.user.id,
    req.params.articleId,
  );

  sendSuccess(res, {
    message: result.liked ? "Article liked." : "Article unliked.",
    data: result,
  });
});

/**
 * POST /api/v1/articles/:articleId/share
 * Record a share on an article.
 */
const shareArticle = asyncHandler(async (req, res) => {
  const result = await engagementService.shareArticle(
    req.user.id,
    req.params.articleId,
    req.body.platform,
  );

  sendSuccess(res, { message: "Share recorded.", data: result });
});

/**
 * POST /api/v1/articles/:articleId/save
 * Toggle save/bookmark on an article.
 */
const toggleSave = asyncHandler(async (req, res) => {
  const result = await engagementService.toggleSaveArticle(
    req.user.id,
    req.params.articleId,
  );

  sendSuccess(res, {
    message: result.saved ? "Article saved." : "Article removed from library.",
    data: result,
  });
});

/**
 * GET /api/v1/library/saved
 * Get user's saved articles.
 */
const getSavedArticles = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { articles, total } = await engagementService.getSavedArticles(
    req.user.id,
    page,
    limit,
  );

  sendPaginated(res, {
    data: articles,
    page,
    limit,
    total,
    message: "Saved articles.",
  });
});

/**
 * GET /api/v1/library/history
 * Get user's read history.
 */
const getReadHistory = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { articles, total } = await engagementService.getReadHistory(
    req.user.id,
    page,
    limit,
  );

  sendPaginated(res, {
    data: articles,
    page,
    limit,
    total,
    message: "Read history.",
  });
});

module.exports = {
  toggleLike,
  shareArticle,
  toggleSave,
  getSavedArticles,
  getReadHistory,
};
