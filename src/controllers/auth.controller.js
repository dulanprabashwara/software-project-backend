const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const authService = require("../services/auth.service");
const admin = require("../config/firebase");
const ApiError = require("../utils/ApiError");

/**
 * Helper to verify ID token and get UID
 */
const getUidFromToken = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Access denied. No token provided.");
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken.uid;
  } catch (error) {
    throw new ApiError(401, "Invalid or expired token.");
  }
};

/**
 * POST /api/v1/auth/register
 * Register a new user (sync Firebase ↔ local DB).
 */
const register = asyncHandler(async (req, res) => {
  const { email, username, displayName, avatarUrl } = req.body;

  // Verify token to ensure legitimate registration
  const firebaseUid = await getUidFromToken(req);

  if (!email || !username) {
    throw new ApiError(400, "Email and username are required.");
  }

  const user = await authService.registerUser({
    firebaseUid,
    email,
    username,
    displayName,
    avatarUrl,
  });

  sendSuccess(res, {
    statusCode: 201,
    message: "User registered successfully.",
    data: user,
  });
});

/**
 * POST /api/v1/auth/sync
 * Sync Firebase user with local database on login.
 * Called after Firebase frontend authentication.
 */
const sync = asyncHandler(async (req, res) => {
  // Securely get UID from verified token
  const firebaseUid = await getUidFromToken(req);

  const user = await authService.syncUser(firebaseUid);

  sendSuccess(res, {
    message: "User synced successfully.",
    data: user,
  });
});

/**
 * GET /api/v1/auth/me
 * Get current authenticated user's profile.
 */
const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, {
    message: "User profile retrieved.",
    data: req.user,
  });
});

module.exports = { register, sync, getMe };
