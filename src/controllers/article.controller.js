/* software-project-backend/src/controllers/article.controller.js */

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendPaginated } = require("../utils/response");
const articleService = require("../services/article.service");
const linkedinService = require("../services/linkedin.service");
const { parsePagination } = require("../utils/helpers");

const createArticle = asyncHandler(async (req, res) => {
  const article = await articleService.createArticle(req.user.id, req.body);

  sendSuccess(res, {
    statusCode: 201,
    message: "Article created successfully.",
    data: article,
  });
});

// currentUserId is optional because public users can read articles too.
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

// Feed filters come from query params, while pagination is normalized separately.
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

// The response message depends on whether the article was published now or scheduled.
const publishArticle = asyncHandler(async (req, res) => {
  const article = await articleService.publishArticle(
    req.app,
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

// Preview saves article data so the user can view it without finalizing the edit.
async function saveEditExistingForPreview(req, res) {
  const article = await articleService.saveExistingArticleForPreview(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message: "Article preview saved.",
    data: article,
  });
}

// Backup is cleared only after the edit-existing flow no longer needs restore data.
const clearEditExistingBackup = asyncHandler(async (req, res) => {
  const article = await articleService.clearEditExistingBackup(
    req.params.id,
    req.user.id,
  );

  sendSuccess(res, {
    message: "Edit-existing backup cleared successfully.",
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

// Convert optional boolean query params into real booleans for service filters.
function parseBooleanQuery(value) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  return undefined;
}

const getDrafts = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);

  const isAiGenerated = parseBooleanQuery(req.query.isAiGenerated);

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
// Trending articles are used by the article suggestion/slider UI.
const getTrendingArticles = asyncHandler(async (req, res) => {
  const articles = await articleService.getTrendingArticles();
  sendSuccess(res, {
    message: "Trending articles retrieved.",
    data: articles,
  });
});

<<<<<<< HEAD
//  EDIT EXISTING FLOW 

/*
 Transitions an existing draft into the active EDITING state and captures a backup 
 to allow for future restoration.
 */
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

/*
 Silently saves the current state of an 'Edit Existing' session.
 */
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

/*
 Temporarily saves state to the 'DRAFT' status so the user can see a live 
 preview without finalizing the edit session.
 */
const saveEditExistingForPreview = asyncHandler(async (req, res) => {
  const article = await articleService.saveExistingArticleForPreview(
    req.params.id,
    req.user.id,
    req.body,
  );

  sendSuccess(res, {
    message: "Article preview saved.",
    data: article,
  });
});

/*
 Finalizes the editing session, updates the main article row, and clears the backup.
 */
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

/*
 Discards all current session changes and restores the article from the original backup.
 */
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

/*
 Explicitly cleans up backup metadata once a session is successfully concluded.
 */
const clearEditExistingBackup = asyncHandler(async (req, res) => {
  const article = await articleService.clearEditExistingBackup(
    req.params.id,
    req.user.id,
  );

  sendSuccess(res, {
    message: "Edit-existing backup cleared successfully.",
    data: article,
  });
});

//  EDIT AS NEW FLOW 

/*
 Creates a temporary clone of an existing article to be edited as a fresh piece.
 */
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

/*
 Background save for cloned articles.
 */
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

/*
 Finalizes a clone into a real, independent draft article.
 */
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

/*
 Deletes the temporary clone if the user cancels the session.
 */
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

  // Auto-sync to LinkedIn if requested in payload
  if (req.body.linkedinSync) {
    const scheduledAt = req.body.timing === "schedule" ? req.body.scheduledAt : null;
    linkedinService
      .scheduleLinkedInPublish(article.id, req.user.id, scheduledAt, req.body.linkedinCaption)
      .catch((err) => console.error("[LinkedIn Auto-Sync Error]", err.message));
  }

  sendSuccess(res, {
    message:
      article.status === "SCHEDULED"
        ? "Article scheduled successfully."
        : "Article published successfully.",
    data: article,
  });
});

/*
 Increments the readCount and tracks history for analytics.
 */
const recordRead = asyncHandler(async (req, res) => {
  await articleService.recordRead(req.params.id, req.user.id);

  sendSuccess(res, { message: "Read recorded." });
});

//  HELPERS 

/*
 Normalizes optional boolean query parameters (like 'true'/'false' strings) 
 into actual Javascript booleans for the service layer.
 */
function parseBooleanQuery(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

=======
>>>>>>> main
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
  saveEditExistingForPreview,
  clearEditExistingBackup,
  startEditAsNew,
  autosaveEditAsNew,
  saveEditAsNewAsDraft,
  discardEditAsNew,
  deleteArticle,
  recordRead,
  getDrafts,
  getTrendingArticles
};