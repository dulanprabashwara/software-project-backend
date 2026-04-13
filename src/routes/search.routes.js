// src/routes/search.routes.js

const { Router }  = require("express");
const admin       = require("../config/firebase");
const prisma      = require("../config/prisma");
const {
  searchArticles,
  searchUsers,
  getSearchSuggestions,
} = require("../controllers/search.controller");

const router = Router();

// ── optionalAuth ──────────────────────────────────────────────────────────────
// Decodes the Firebase Bearer token when present → sets req.user = { id, role }
// Silently skips (no 401) when token is absent or invalid.
// ─────────────────────────────────────────────────────────────────────────────
const optionalAuth = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return next();

    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) return next();

    const decoded = await admin.auth().verifyIdToken(idToken);

    const user = await prisma.user.findUnique({
      where:  { firebaseUid: decoded.uid },
      select: { id: true, role: true },
    });

    if (user) req.user = user;
  } catch {
    // Expired / malformed token → treat as anonymous, never block
  }
  next();
};

// GET /api/search/articles — optionalAuth resolves isSaved for logged-in users
router.get("/articles",    optionalAuth, searchArticles);

// GET /api/search/users    — optionalAuth resolves isFollowing for logged-in users
router.get("/users",       optionalAuth, searchUsers);

// GET /api/search/suggestions — fully public, no user-specific data
router.get("/suggestions", getSearchSuggestions);

module.exports = router;