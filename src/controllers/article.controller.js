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

const publishArticle = asyncHandler(async (req, res) => {
  const article = await articleService.publishArticle(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message:
      article.status === "SCHEDULED"
        ? "Article scheduled successfully."
        : "Article published successfully.",
    data: article,
  });
});

const getPublishedByUser = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);

  const { articles, total } = await articleService.getUserPublishedArticles(
    req.user.id,
    page,
    limit,
  );

  sendPaginated(res, {
    data: articles,
    page,
    limit,
    total,
    message: "Published articles retrieved.",
  });
});

const getPublishedByUsername = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);

  const { articles, total } = await articleService.getPublishedArticlesByUsername(
    req.params.username,
    page,
    limit,
  );

  sendPaginated(res, {
    data: articles,
    page,
    limit,
    total,
    message: "User published articles retrieved.",
  });
});

const getScheduledByUser = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);

  const { articles, total } = await articleService.getUserScheduledArticles(
    req.user.id,
    page,
    limit,
  );

  sendPaginated(res, {
    data: articles,
    page,
    limit,
    total,
    message: "Scheduled articles retrieved.",
  });
});

const startEditExisting = asyncHandler(async (req, res) => {
  const article = await articleService.startExistingArticleEditing(
    req.params.id,
    req.user.id,
  );

  sendSuccess(res, {
    message: "Existing article editing session started.",
    data: article,
  });
});

const autosaveEditExisting = asyncHandler(async (req, res) => {
  const article = await articleService.autosaveExistingArticle(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message: "Existing article autosaved.",
    data: article,
  });
});

const discardEditExisting = asyncHandler(async (req, res) => {
  const article = await articleService.discardExistingArticleEdits(
    req.params.id,
    req.user.id,
  );

  sendSuccess(res, {
    message: "Article changes discarded successfully.",
    data: article,
  });
});

const saveEditExistingAsDraft = asyncHandler(async (req, res) => {
  const article = await articleService.saveExistingArticleAsDraft(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message: "Edited article saved as draft successfully.",
    data: article,
  });
});

const startEditAsNew = asyncHandler(async (req, res) => {
  const article = await articleService.startEditAsNewArticle(
    req.params.id,
    req.user.id,
  );

  sendSuccess(res, {
    statusCode: 201,
    message: "Edit-as-new article created successfully.",
    data: article,
  });
});

const autosaveEditAsNew = asyncHandler(async (req, res) => {
  const article = await articleService.autosaveEditAsNewArticle(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message: "Edit-as-new article autosaved successfully.",
    data: article,
  });
});

const saveEditAsNewAsDraft = asyncHandler(async (req, res) => {
  const article = await articleService.saveEditAsNewArticleAsDraft(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message: "Edit-as-new article saved as draft successfully.",
    data: article,
  });
});

const discardEditAsNew = asyncHandler(async (req, res) => {
  await articleService.discardEditAsNewArticle(
    req.params.id,
    req.user.id,
  );

  sendSuccess(res, {
    message: "Edit-as-new article discarded successfully.",
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
// GET /api/articles/trending
const getTrendingArticles = asyncHandler(async (req, res) => {
  const articles = await articleService.getTrendingArticles();
  res.status(200).json({ success: true, articles });
});

module.exports = {
  createArticle,
  getArticle,
  getArticleById,
  getCurrentEditing,
  getFeed,
  updateArticle,
  publishArticle,
  getPublishedByUser,
  getPublishedByUsername,
  getScheduledByUser,
  startEditExisting,
  autosaveEditExisting,
  discardEditExisting,
  saveEditExistingAsDraft,
  startEditAsNew,
  autosaveEditAsNew,
  saveEditAsNewAsDraft,
  discardEditAsNew,
  deleteArticle,
  recordRead,
  getDrafts,
  getTrendingArticles
};