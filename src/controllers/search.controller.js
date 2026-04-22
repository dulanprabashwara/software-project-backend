const asyncHandler    = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const searchService   = require("../services/search.service");

const EMPTY_ARTICLES = { articles: [], total: 0, page: 1, limit: 10, totalPages: 0 };
const EMPTY_USERS    = { users:    [], total: 0, page: 1, limit: 10, totalPages: 0 };

const parsePage  = (val) => Math.max(1,  parseInt(val, 10) || 1);
const parseLimit = (val) => Math.min(50, parseInt(val, 10) || 10);

// GET /api/search/articles?q=&page=&limit=
const searchArticles = asyncHandler(async (req, res) => {
  const { q = "", page = "1", limit = "10" } = req.query;

  if (!q.trim()) {
    return sendSuccess(res, { data: EMPTY_ARTICLES, message: "No query provided" });
  }

  const result = await searchService.searchArticles({
    query:         q,
    page:          parsePage(page),
    limit:         parseLimit(limit),
    currentUserId: req.user?.id ?? null,
  });

  sendSuccess(res, { data: result, message: "Article search results fetched" });
});

// GET /api/search/users?q=&page=&limit=
const searchUsers = asyncHandler(async (req, res) => {
  const { q = "", page = "1", limit = "10" } = req.query;

  if (!q.trim()) {
    return sendSuccess(res, { data: EMPTY_USERS, message: "No query provided" });
  }

  const result = await searchService.searchUsers({
    query:         q,
    page:          parsePage(page),
    limit:         parseLimit(limit),
    currentUserId: req.user?.id ?? null,
  });

  sendSuccess(res, { data: result, message: "User search results fetched" });
});

// GET /api/search/suggestions?q=
const getSearchSuggestions = asyncHandler(async (req, res) => {
  const result = await searchService.getSearchSuggestions(req.query.q || "");
  sendSuccess(res, { data: result, message: "Suggestions fetched" });
});

module.exports = { searchArticles, searchUsers, getSearchSuggestions };