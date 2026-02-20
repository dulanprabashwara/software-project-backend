// ai.controller.js — FIXED version

const aiService = require("../services/ai.service");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// POST /api/ai/analyze
const analyzePrompt = asyncHandler(async (req, res) => {
  const { userInput } = req.body;
  if (!userInput?.trim()) throw ApiError.badRequest("userInput is required.");

  const result = await aiService.analyzePrompt(userInput);
  
  res.status(200).json({ success: true, ...result });
});

// POST /api/ai/generate
const generateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId) throw ApiError.badRequest("userInput or sessionId is required.");

  const result = await aiService.generateArticle({ sessionId, userInput, selectedKeywords, articleLength, tone });
  
  res.status(200).json({ success: true, article: result });
});

// POST /api/ai/regenerate
const regenerateArticle = asyncHandler(async (req, res) => {
  const { sessionId, userInput, selectedKeywords, articleLength, tone } = req.body;
  if (!userInput?.trim() && !sessionId) throw ApiError.badRequest("userInput or sessionId is required.");

  const result = await aiService.regenerateArticle({ sessionId, userInput, selectedKeywords, articleLength, tone });
  
  res.status(200).json({ success: true, article: result });
});

module.exports = { analyzePrompt, generateArticle, regenerateArticle };