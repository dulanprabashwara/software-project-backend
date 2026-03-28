const aiService    = require("../services/ai.service");
const asyncHandler = require("../utils/asyncHandler");
const ApiError     = require("../utils/ApiError");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/analyze
// Runs after authenticate + requirePremium — req.user is always populated here.
// ─────────────────────────────────────────────────────────────────────────────
const analyzePrompt = asyncHandler(async (req, res) => {
  const { userInput } = req.body;
  if (!userInput?.trim()) throw ApiError.badRequest("userInput is required.");

  const result = await aiService.analyzePrompt(userInput);
  res.status(200).json({ success: true, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/generate
// Auto-saves to AiArticleLog in DB using req.user.id as authorId.
// Returns: { success, article: { title, content, wordCount, logId } }
// Frontend stores logId — sends it back when user clicks "Save Draft".
// ─────────────────────────────────────────────────────────────────────────────
const generateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId)
    throw ApiError.badRequest("userInput or sessionId is required.");

  const result = await aiService.generateArticle({
    sessionId,
    userInput,
    selectedKeywords,
    articleLength,
    tone,
    authorId: req.user.id,   // always from verified token, never from request body
  });

  res.status(200).json({ success: true, article: result });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/regenerate
// Produces a completely different article version.
// Each call creates a new AiArticleLog row with a new logId.
// ─────────────────────────────────────────────────────────────────────────────
const regenerateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId)
    throw ApiError.badRequest("userInput or sessionId is required.");

  const result = await aiService.regenerateArticle({
    sessionId,
    userInput,
    selectedKeywords,
    articleLength,
    tone,
    authorId: req.user.id,
  });

  res.status(200).json({ success: true, article: result });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/save-draft
// Body: { logId }   — logId returned from /generate or /regenerate
// authorId always comes from req.user.id, never from the request body.
// ─────────────────────────────────────────────────────────────────────────────
const saveDraft = asyncHandler(async (req, res) => {
  const { logId } = req.body;
  if (!logId) throw ApiError.badRequest("logId is required.");

  // Verify ownership — the log must belong to the authenticated user
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
// GET /api/ai/logs
// Returns only this authenticated user's generation history.
// No query params needed — user identity comes from the token.
// ─────────────────────────────────────────────────────────────────────────────
const getArticleLogs = asyncHandler(async (req, res) => {
  const logs = await aiService.getArticleLogs(req.user.id);
  res.status(200).json({ success: true, logs });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/logs/:id
// Returns full detail of one AiArticleLog for the article detail page.
// Validates that the log belongs to the requesting user before returning.
// ─────────────────────────────────────────────────────────────────────────────
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
  getArticleLogs,
  getArticleLogById,
};