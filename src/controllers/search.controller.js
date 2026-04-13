// src/controllers/search.controller.js


const asyncHandler    = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const searchService   = require("../services/search.service");

// GET /api/search/articles?q=term&page=1&limit=10
const searchArticles = asyncHandler(async (req, res) => {
  const { q = "", page = "1", limit = "10" } = req.query;

  if (!q.trim()) {
    return sendSuccess(res, {
      data:    { articles: [], total: 0, page: 1, limit: 10, totalPages: 0 },
      message: "No query provided",
    });
  }

  const result = await searchService.searchArticles({
    query:         q,
    page:          Math.max(1, parseInt(page,  10) || 1),
    limit:         Math.min(50, parseInt(limit, 10) || 10),
    currentUserId: req.user?.id ?? null,  // ← from optionalAuth on /articles route
  });

  sendSuccess(res, { data: result, message: "Article search results fetched" });
});

// GET /api/search/users?q=term&page=1&limit=10
const searchUsers = asyncHandler(async (req, res) => {
  const { q = "", page = "1", limit = "10" } = req.query;

  if (!q.trim()) {
    return sendSuccess(res, {
      data:    { users: [], total: 0, page: 1, limit: 10, totalPages: 0 },
      message: "No query provided",
    });
  }

  const result = await searchService.searchUsers({
    query:         q,
    page:          Math.max(1, parseInt(page,  10) || 1),
    limit:         Math.min(50, parseInt(limit, 10) || 10),
    currentUserId: req.user?.id ?? null,  // from optionalAuth on /users route
  });

  sendSuccess(res, { data: result, message: "User search results fetched" });
});

// GET /api/search/suggestions?q=term
const getSearchSuggestions = asyncHandler(async (req, res) => {
  const { q = "" } = req.query;
  const result = await searchService.getSearchSuggestions(q);
  sendSuccess(res, { data: result, message: "Suggestions fetched" });
});

module.exports = { searchArticles, searchUsers, getSearchSuggestions };