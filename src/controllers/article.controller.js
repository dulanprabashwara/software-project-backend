/* software-project-backend/src/controllers/article.controller.js */

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const articleService = require("../services/article.service");
const { parsePagination } = require("../utils/helpers");

const createArticle = asyncHandler(async (req, res) => {
  const article = await articleService.createArticle(req.user.id, req.body);

  sendSuccess(res, {
    statusCode: 201,
    message: "Article created successfully.",
    data: article,
  });
});

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

const getArticleById = asyncHandler(async (req, res) => {
  const article = await articleService.getArticleById(
    req.params.id,
    req.user.id,
  );

  sendSuccess(res, {
    message: "Article retrieved.",
    data: article,
  });
});

const getCurrentEditing = asyncHandler(async (req, res) => {
  const article = await articleService.getCurrentEditingArticle(req.user.id);

  sendSuccess(res, {
    message: "Current editing article retrieved.",
    data: article,
  });
});

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

const deleteArticle = asyncHandler(async (req, res) => {
  await articleService.deleteArticle(req.params.id, req.user.id, req.user.role);

  sendSuccess(res, { message: "Article deleted successfully." });
});

const recordRead = asyncHandler(async (req, res) => {
  await articleService.recordRead(req.params.id, req.user.id);

  sendSuccess(res, { message: "Read recorded." });
});

const getDrafts = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);

  let isAiGenerated;
  if (req.query.isAiGenerated === "true") {
    isAiGenerated = true;
  } else if (req.query.isAiGenerated === "false") {
    isAiGenerated = false;
  }

  const { drafts, total } = await articleService.getUserDrafts(
    req.user.id,
    page,
    limit,
    { isAiGenerated },
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
  getArticleById,
  getCurrentEditing,
  getFeed,
  updateArticle,
  deleteArticle,
  recordRead,
  getDrafts,
};