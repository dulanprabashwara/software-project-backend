/**
 * ai.service.js — re-export barrel
 *
 * The service has been split into three focused modules:
 *   ai.generation.service.js  — analyzePrompt, generateArticle, regenerateArticle
 *   ai.logs.service.js        — saveDraft, loadToEditor, softDeleteLog, restoreLog,
 *                               getArticleLogs, getArticleLogById, setUserResponse
 *   ai.sidebar.service.js     — getTrendingKeywords, getTopAIArticles
 *
 * This file re-exports everything so that any existing code using
 *   require("../services/ai.service")
 * continues to work without modification.
 */

const generation = require("./ai.generation.service");
const logs       = require("./ai.logs.service");
const sidebar    = require("./ai.sidebar.service");

module.exports = {
  // generation
  analyzePrompt:     generation.analyzePrompt,
  generateArticle:   generation.generateArticle,
  regenerateArticle: generation.regenerateArticle,
  sessionCache:      generation.sessionCache,

  // logs
  saveDraft:         logs.saveDraft,
  loadToEditor:      logs.loadToEditor,
  softDeleteLog:     logs.softDeleteLog,
  restoreLog:        logs.restoreLog,
  getArticleLogs:    logs.getArticleLogs,
  getArticleLogById: logs.getArticleLogById,
  setUserResponse:   logs.setUserResponse,

  // sidebar
  getTrendingKeywords: sidebar.getTrendingKeywords,
  getTopAIArticles:    sidebar.getTopAIArticles,
};