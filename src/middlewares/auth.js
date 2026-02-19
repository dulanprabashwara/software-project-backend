const admin = require("../config/firebase");
const prisma = require("../config/prisma");

/**
 * Middleware: Authenticate requests using Firebase ID tokens.
 *
 * Expects: Authorization: Bearer <idToken>
 * Attaches: req.user (Prisma User record) to the request.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const idToken = authHeader.split("Bearer ")[1];

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Fetch the user from our database using the Firebase UID
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
      include: { bannedRecord: true },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found. Please register first.",
      });
    }

    // Check if user is banned
    if (user.bannedRecord) {
      const ban = user.bannedRecord;
      const isPermanent = !ban.bannedUntil;
      const isStillBanned =
        isPermanent || new Date() < new Date(ban.bannedUntil);

      if (isStillBanned) {
        return res.status(403).json({
          success: false,
          message: "Your account has been suspended.",
          reason: ban.reason,
          bannedUntil: ban.bannedUntil,
        });
      }
    }

    // Update online status
    await prisma.user.update({
      where: { id: user.id },
      data: { isOnline: true, lastSeen: new Date() },
    });

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);

    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please log in again.",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};

/**
 * Middleware: Authorize by role.
 * Must be used AFTER `authenticate`.
 *
 * @param  {...string} roles - Allowed roles (e.g. "ADMIN", "USER")
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }

    next();
  };
};

/**
 * Middleware: Require premium subscription.
 * Must be used AFTER `authenticate`.
 */
const requirePremium = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  if (!req.user.isPremium && req.user.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "This feature requires a premium subscription.",
    });
  }

  next();
};

module.exports = { authenticate, authorize, requirePremium };
