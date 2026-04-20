const admin = require("../config/firebase");
const prisma = require("../config/prisma");

/**
 * @function authenticate
 * @description
 * Express middleware to authenticate inbound requests using Firebase ID tokens.
 * WHY: verify the JWT token against Firebase
 * to prove the user's identity before interacting with our own Postgres database.
 *
 * @param {Object} req - Express request object. Expects `Authorization: Bearer <token>` in headers.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>} Attaches the verified Postgres `User` record to `req.user` or returns 401/403/500 on failure.
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

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication/Database error:", error.message);

    // If the error comes from Firebase Auth verifyIdToken (usually starts with 'auth/'), if the token is invalid or expired
    if (
      error.code &&
      typeof error.code === "string" &&
      error.code.startsWith("auth/")
    ) {
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

    // Otherwise, it is likely a Prisma database connection error or generic error
    return res.status(500).json({
      success: false,
      message:
        "An internal server/database error occurred during authentication.",
      error: error.message,
    });
  }
};

/**
 * @function authorize
 * @description
 * Express middleware to authorize users based on internal roles.
 * Must be executed AFTER the `authenticate` middleware to ensure `req.user` is present.
 *
 * @param {...string} roles - An array of allowed role strings (e.g., 'ADMIN', 'USER').
 * @returns {Function} Express middleware function checking for role inclusion. Returns 403 on denial.
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
 * @function requirePremium
 * @description
 * Express middleware to restrict access to premium-only features.
 *
 * @param {Object} req - Express request object. Expects `req.user` to be populated.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {void} Proceeds if `isPremium` is true or role is 'ADMIN', else returns 403.
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

/**
 * @function optionalAuth
 * @description
 * Express middleware for endpoints that behave differently depending on auth state.
 * WHY: Some public endpoints need to know if the viewer is authenticated , but shouldn't block
 * anonymous/public viewers if no token is provided.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>} Attaches `req.user` if valid token is found, otherwise proceeds silently.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(); // No token — proceed as anonymous
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    const user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
    });

    if (user) {
      req.user = user;
    }
  } catch {
    // Token invalid or expired — silently ignore and proceed as anonymous
  }
  next();
};

module.exports = { authenticate, authorize, requirePremium, optionalAuth };
