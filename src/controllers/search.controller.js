// src/controllers/search.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin controller — validates query params then delegates to search.service.js.
// Follows the same asyncHandler + sendSuccess pattern used across the project.
// ─────────────────────────────────────────────────────────────────────────────

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const searchService = require("../services/search.service");

// GET /api/search/articles?q=term&page=1&limit=10
const searchArticles = asyncHandler(async (req, res) => {
  const { q = "", page = "1", limit = "10" } = req.query;

  // Return empty result for blank queries instead of erroring
  if (!q.trim()) {
    return sendSuccess(res, { articles: [], total: 0, page: 1, limit: 10, totalPages: 0 }, "No query provided");
  }

  const result = await searchService.searchArticles({
    query: q,
    page:  Math.max(1, parseInt(page)  || 1),
    limit: Math.min(50, parseInt(limit) || 10), // cap at 50 per page
  });

  sendSuccess(res, result, "Article search results fetched");
});

// GET /api/search/users?q=term&page=1&limit=10
const searchUsers = asyncHandler(async (req, res) => {
  const { q = "", page = "1", limit = "10" } = req.query;

  if (!q.trim()) {
    return sendSuccess(res, { users: [], total: 0, page: 1, limit: 10, totalPages: 0 }, "No query provided");
  }

  const result = await searchService.searchUsers({
    query: q,
    page:  Math.max(1, parseInt(page)  || 1),
    limit: Math.min(50, parseInt(limit) || 10),
  });

  sendSuccess(res, result, "User search results fetched");
});

// GET /api/search/suggestions?q=term
// Lightweight autocomplete endpoint — no auth required, no pagination.
const getSearchSuggestions = asyncHandler(async (req, res) => {
  const { q = "" } = req.query;

  const result = await searchService.getSearchSuggestions(q);
  sendSuccess(res, result, "Suggestions fetched");
});

module.exports = { searchArticles, searchUsers, getSearchSuggestions };
