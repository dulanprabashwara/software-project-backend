// src/routes/search.routes.js
// ─────────────────────────────────────────────────────────────────────────────
// All search endpoints are public (no auth middleware) so even non-logged-in
// users can search. If you want auth-only search in future, add the
// `authenticate` middleware from middlewares/auth.js to the routes below.
// ─────────────────────────────────────────────────────────────────────────────

const { Router } = require("express");
const {
  searchArticles,
  searchUsers,
  getSearchSuggestions,
} = require("../controllers/search.controller");

const router = Router();

// GET /api/search/articles?q=term&page=1&limit=10
router.get("/articles", searchArticles);

// GET /api/search/users?q=term&page=1&limit=10
router.get("/users", searchUsers);

// GET /api/search/suggestions?q=term
// Called on every debounced keystroke — returns top 5 article titles + 3 users
router.get("/suggestions", getSearchSuggestions);

module.exports = router;
