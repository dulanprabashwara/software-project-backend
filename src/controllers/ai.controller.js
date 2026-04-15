const aiService    = require("../services/ai.service");
const asyncHandler = require("../utils/asyncHandler");
const ApiError     = require("../utils/ApiError");

const analyzePrompt = asyncHandler(async (req, res) => {
  const { userInput } = req.body;
  if (!userInput?.trim()) throw ApiError.badRequest("userInput is required.");
  const result = await aiService.analyzePrompt(userInput);
  res.status(200).json({ success: true, ...result });
});

const generateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId)
    throw ApiError.badRequest("userInput or sessionId is required.");
  const result = await aiService.generateArticle({
    sessionId, userInput, selectedKeywords, articleLength, tone,
    authorId: req.user.id,
  });
  res.status(200).json({ success: true, article: result });
});

const regenerateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId)
    throw ApiError.badRequest("userInput or sessionId is required.");
  const result = await aiService.regenerateArticle({
    sessionId, userInput, selectedKeywords, articleLength, tone,
    authorId: req.user.id,
  });
  res.status(200).json({ success: true, article: result });
});

const saveDraft = asyncHandler(async (req, res) => {
  const { logId } = req.body;
  if (!logId) throw ApiError.badRequest("logId is required.");
  const { draft, alreadySaved } = await aiService.saveDraft({
    logId,
    authorId: req.user.id,
  });
  res.status(alreadySaved ? 200 : 201).json({
    success: true,
    alreadySaved,
    message: alreadySaved
      ? "This article was already saved to drafts."
      : "Article saved to drafts successfully.",
    draft,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/load-to-editor
// Called when user clicks "Edit" on an AI-generated article preview.
// Creates an Article with status EDITING and isAiGenerated: true from the log.
// Returns { articleId } — frontend navigates to /write/create.
// The write/create page calls GET /articles/user/editing on mount, finds this
// article (most recently updated EDITING), and loads it into TinyMCE.
// ─────────────────────────────────────────────────────────────────────────────
const loadToEditor = asyncHandler(async (req, res) => {
  const { logId } = req.body;
  if (!logId) throw ApiError.badRequest("logId is required.");

  const { articleId } = await aiService.loadToEditor({
    logId,
    authorId: req.user.id,
  });

  res.status(200).json({ success: true, articleId });
});

const getArticleLogs = asyncHandler(async (req, res) => {
  const logs = await aiService.getArticleLogs(req.user.id);
  res.status(200).json({ success: true, logs });
});

const getArticleLogById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("Article id is required.");
  const log = await aiService.getArticleLogById(id, req.user.id);
  res.status(200).json({ success: true, log });
});

module.exports = {
  analyzePrompt,
  generateArticle,
  regenerateArticle,
  saveDraft,
  loadToEditor,
  getArticleLogs,
  getArticleLogById,
};

