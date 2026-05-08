// @ts-nocheck
const asyncHandler    = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const searchService   = require("../services/search.service");

const EMPTY_ARTICLES   = { articles: [], total: 0, page: 1, limit: 10, totalPages: 0 };
const EMPTY_USERS      = { users:    [], total: 0, page: 1, limit: 10, totalPages: 0 };
const DEFAULT_PAGE     = "1";
const DEFAULT_LIMIT    = "10";
const MIN_PAGE         = 1;
const MAX_LIMIT        = 50;

// Clamps parsed page value to a minimum of 1.
const parsePage  = (val) => Math.max(MIN_PAGE, parseInt(val, 10) || MIN_PAGE);

// Clamps parsed limit value to a maximum of MAX_LIMIT.
const parseLimit = (val) => Math.min(MAX_LIMIT, parseInt(val, 10) || parseInt(DEFAULT_LIMIT, 10));

// GET /api/search/articles?q=&page=&limit=
// Returns paginated published articles matching the query, with isSaved flags for authenticated users.
const searchArticles = asyncHandler(async (req, res) => {
  const { q = "", page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = req.query;

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
// Returns paginated users matching the query by username or display name, with isFollowing flags for authenticated users.
const searchUsers = asyncHandler(async (req, res) => {
  const { q = "", page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = req.query;

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
// Returns lightweight autocomplete suggestions (articles + users) for the given partial query.
const getSearchSuggestions = asyncHandler(async (req, res) => {
  const result = await searchService.getSearchSuggestions(req.query.q || "");
  sendSuccess(res, { data: result, message: "Suggestions fetched" });
});

module.exports = { searchArticles, searchUsers, getSearchSuggestions };