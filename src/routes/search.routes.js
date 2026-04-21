const { Router } = require("express");
const admin      = require("../config/firebase");
const prisma     = require("../config/prisma");
const {
  searchArticles,
  searchUsers,
  getSearchSuggestions,
} = require("../controllers/search.controller");

const router = Router();

// Decodes the Bearer token when present and attaches req.user.
// Never returns 401 — anonymous requests pass through with req.user undefined.
// Used on routes that return personalised data (isSaved, isFollowing) for
// logged-in users while remaining accessible to anonymous visitors.
const optionalAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return next();

    const token   = header.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const user    = await prisma.user.findUnique({
      where:  { firebaseUid: decoded.uid },
      select: { id: true, role: true },
    });

    if (user) req.user = user;
  } catch {
    // Expired or malformed token — treat as anonymous
  }
  next();
};

router.get("/articles",    optionalAuth, searchArticles);
router.get("/users",       optionalAuth, searchUsers);
router.get("/suggestions", getSearchSuggestions);

module.exports = router;