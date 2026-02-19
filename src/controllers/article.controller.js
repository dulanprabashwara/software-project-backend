const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const articleService = require("../services/article.service");
const { parsePagination } = require("../utils/helpers");

/**
 * POST /api/v1/articles
 * Create a new article.
 */
const createArticle = asyncHandler(async (req, res) => {
  const article = await articleService.createArticle(req.user.id, req.body);

  sendSuccess(res, {
    statusCode: 201,
    message: "Article created successfully.",
    data: article,
  });
});

/**
 * GET /api/v1/articles/:slug
 * Get an article by slug.
 */
const getArticle = asyncHandler(async (req, res) => {
  const currentUserId = req.user?.id || null;
  const article = await articleService.getArticleBySlug(
    req.params.slug,
    currentUserId,
  );

  sendSuccess(res, {
    message: "Article retrieved.",
    data: article,
  });
});

/**
 * GET /api/v1/articles
 * Get published articles feed.
 * Query: ?page=1&limit=10&tag=javascript&search=react&sortBy=latest|popular
 */
const getFeed = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { tag, search, sortBy, authorId } = req.query;

  const { articles, total } = await articleService.getArticleFeed({
    page,
    limit,
    tag,
    authorId,
    search,
    sortBy,
  });

  sendPaginated(res, { data: articles, page, limit, total });
});

/**
 * PUT /api/v1/articles/:id
 * Update an article.
 */
const updateArticle = asyncHandler(async (req, res) => {
  const article = await articleService.updateArticle(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message: "Article updated successfully.",
    data: article,
  });
});

/**
 * DELETE /api/v1/articles/:id
 * Delete an article.
 */
const deleteArticle = asyncHandler(async (req, res) => {
  await articleService.deleteArticle(req.params.id, req.user.id, req.user.role);

  sendSuccess(res, { message: "Article deleted successfully." });
});

/**
 * POST /api/v1/articles/:id/read
 * Record a read on an article.
 */
const recordRead = asyncHandler(async (req, res) => {
  await articleService.recordRead(req.params.id, req.user.id);

  sendSuccess(res, { message: "Read recorded." });
});

/**
 * GET /api/v1/articles/user/drafts
 * Get current user's draft articles.
 */
const getDrafts = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { drafts, total } = await articleService.getUserDrafts(
    req.user.id,
    page,
    limit,
  );

  sendPaginated(res, {
    data: drafts,
    page,
    limit,
    total,
    message: "Drafts retrieved.",
  });
});

module.exports = {
  createArticle,
  getArticle,
  getFeed,
  updateArticle,
  deleteArticle,
  recordRead,
  getDrafts,
};
