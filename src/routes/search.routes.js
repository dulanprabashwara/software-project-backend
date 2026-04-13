// src/routes/search.routes.js

const { Router }     = require("express");
const admin          = require("../config/firebase"); // Firebase Admin SDK instance
const prisma         = require("../config/prisma");
const {
  searchArticles,
  searchUsers,
  getSearchSuggestions,
} = require("../controllers/search.controller");

const router = Router();

// ── optionalAuth ─────────────────────────────────────────────────────────────
// Tries to decode the Bearer token from the Authorization header.
// If successful  → sets req.user = { id: prismaUserId } and calls next()
// If missing/bad → just calls next() with req.user = undefined (no 401 thrown)
// ─────────────────────────────────────────────────────────────────────────────
const optionalAuth = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return next(); // anonymous — skip

    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) return next();

    // Verify the Firebase ID token using the existing Firebase Admin SDK
    const decoded = await admin.auth().verifyIdToken(idToken);

    // Look up the Prisma user by Firebase UID — same pattern as authenticate middleware
    const user = await prisma.user.findUnique({
      where:  { firebaseUid: decoded.uid },
      select: { id: true, role: true },
    });

    if (user) req.user = user; // controller reads req.user?.id
  } catch {
    // Expired / malformed token → treat as anonymous, never block
  }
  next();
};

// GET /api/search/articles?q=term&page=1&limit=10 — fully public
router.get("/articles", searchArticles);

// GET /api/search/users?q=term&page=1&limit=10
// optionalAuth sets req.user when logged in so isFollowing is resolved per user
router.get("/users", optionalAuth, searchUsers);

// GET /api/search/suggestions?q=term — fully public
router.get("/suggestions", getSearchSuggestions);

module.exports = router;
