const aiService    = require("../services/ai.service");
const asyncHandler = require("../utils/asyncHandler");
const ApiError     = require("../utils/ApiError");

// Analyzes the user's prompt and returns extracted keywords + session ID.
const analyzePrompt = asyncHandler(async (req, res) => {
  const { userInput } = req.body;
  if (!userInput?.trim()) throw ApiError.badRequest("userInput is required.");
  const result = await aiService.analyzePrompt(userInput);
  res.status(200).json({ success: true, ...result });
});

// Generates a new AI article from the user's prompt and selected settings.
const generateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId) throw ApiError.badRequest("userInput or sessionId is required.");
  const result = await aiService.generateArticle({
    sessionId, userInput, selectedKeywords, articleLength, tone,
    authorId: req.user.id,
  });
  res.status(200).json({ success: true, article: result });
});

// Generates a fresh, different version of the article using the same settings.
const regenerateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId) throw ApiError.badRequest("userInput or sessionId is required.");
  const result = await aiService.regenerateArticle({
    sessionId, userInput, selectedKeywords, articleLength, tone,
    authorId: req.user.id,
  });
  res.status(200).json({ success: true, article: result });
});

// Saves the AI-generated article as a draft in the articles table.
const saveDraft = asyncHandler(async (req, res) => {
  const { logId } = req.body;
  if (!logId) throw ApiError.badRequest("logId is required.");
  const { draft, alreadySaved } = await aiService.saveDraft({ logId, authorId: req.user.id });
  res.status(alreadySaved ? 200 : 201).json({
    success: true, alreadySaved,
    message: alreadySaved ? "This article was already saved to drafts." : "Article saved to drafts successfully.",
    draft,
  });
});

// Loads the AI article into the TinyMCE editor for manual editing.
const loadToEditor = asyncHandler(async (req, res) => {
  const { logId } = req.body;
  if (!logId) throw ApiError.badRequest("logId is required.");
  const { articleId } = await aiService.loadToEditor({ logId, authorId: req.user.id });
  res.status(200).json({ success: true, articleId });
});

// Soft-deletes an AI article log — it can be restored within 1 hour.
const deleteLog = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("Article id is required.");
  await aiService.softDeleteLog({ logId: id, authorId: req.user.id });
  res.status(200).json({ success: true, message: "Article deleted. You can restore it within 1 hour." });
});

// Restores a soft-deleted AI article log within the 1-hour restore window.
const restoreLog = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("Article id is required.");
  await aiService.restoreLog({ logId: id, authorId: req.user.id });
  res.status(200).json({ success: true, message: "Article restored successfully." });
});

// Returns the list of the user's AI-generated article logs (unsaved drafts).
const getArticleLogs = asyncHandler(async (req, res) => {
  const logs = await aiService.getArticleLogs(req.user.id);
  res.status(200).json({ success: true, logs });
});

// Returns the full details of a single AI article log by ID.
const getArticleLogById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("Article id is required.");
  const log = await aiService.getArticleLogById(id, req.user.id);
  res.status(200).json({ success: true, log });
});

// Returns the most frequently chosen keywords from recent AI generations.
const getTrendingKeywords = asyncHandler(async (req, res) => {
  const keywords = await aiService.getTrendingKeywords();
  res.status(200).json({ success: true, keywords });
});

// Returns the top 5 AI-assisted articles by trending score for the Insights sidebar.
const getTopAIArticles = asyncHandler(async (req, res) => {
  const articles = await aiService.getTopAIArticles();
  res.status(200).json({ success: true, articles });
});

// Sets or clears the user's like/dislike reaction on an AI article log.
const setUserResponse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { response } = req.body;
  if (!id) throw ApiError.badRequest("Article id is required.");
  if (response !== null && response !== "satisfied" && response !== "dissatisfied") {
    throw ApiError.badRequest("response must be 'satisfied', 'dissatisfied', or null.");
  }
  const updatedResponse = await aiService.setUserResponse({ logId: id, authorId: req.user.id, response });
  res.status(200).json({ success: true, userResponse: updatedResponse });
});

module.exports = {
  analyzePrompt,
  generateArticle,
  regenerateArticle,
  saveDraft,
  loadToEditor,
  deleteLog,
  restoreLog,
  getArticleLogs,
  getArticleLogById,
  getTrendingKeywords,
  getTopAIArticles,
  setUserResponse,
};