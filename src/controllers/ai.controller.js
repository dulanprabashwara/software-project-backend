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
  if (!userInput?.trim() && !sessionId) throw ApiError.badRequest("userInput or sessionId is required.");
  const result = await aiService.generateArticle({
    sessionId, userInput, selectedKeywords, articleLength, tone,
    authorId: req.user.id,
  });
  res.status(200).json({ success: true, article: result });
});

const regenerateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId) throw ApiError.badRequest("userInput or sessionId is required.");
  const result = await aiService.regenerateArticle({
    sessionId, userInput, selectedKeywords, articleLength, tone,
    authorId: req.user.id,
  });
  res.status(200).json({ success: true, article: result });
});

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

const loadToEditor = asyncHandler(async (req, res) => {
  const { logId } = req.body;
  if (!logId) throw ApiError.badRequest("logId is required.");
  const { articleId } = await aiService.loadToEditor({ logId, authorId: req.user.id });
  res.status(200).json({ success: true, articleId });
});
//DELETE /api/ai/logs/:id
const deleteLog = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("Article id is required.");
  await aiService.softDeleteLog({ logId: id, authorId: req.user.id });
  res.status(200).json({ success: true, message: "Article deleted. You can restore it within 1 hour." });
});
//POST /api/ai/logs/:id/restore
const restoreLog = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("Article id is required.");
  await aiService.restoreLog({ logId: id, authorId: req.user.id });
  res.status(200).json({ success: true, message: "Article restored successfully." });
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

// GET /api/ai/trending-keywords

const getTrendingKeywords = asyncHandler(async (req, res) => {
  const keywords = await aiService.getTrendingKeywords();
  res.status(200).json({ success: true, keywords });
});
// GET /api/ai/top-ai-articles
const getTopAIArticles = asyncHandler(async (req, res) => {
  const articles = await aiService.getTopAIArticles();
  res.status(200).json({ success: true, articles });
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
};