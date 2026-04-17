const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const authService = require("../services/auth.service");
const admin = require("../config/firebase");
const ApiError = require("../utils/ApiError");

/**
 * @function getUidFromToken
 * @description
 * Extracts and cryptographically verifies the Firebase UID from an incoming Authorization header.
 * WHY: This acts as the secure identity parser for authentication flows, preventing spoofed UIDs.
 * 
 * @param {Object} req - Express request object containing `headers.authorization`.
 * @returns {Promise<string>} The verified Firebase UID.
 * @throws {ApiError} 401 if token is missing, invalid, or expired.
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
    console.error("Firebase Token Verification Error in sync:", error);
    throw new ApiError(401, "Invalid or expired token.");
  }
};

/**
 * @function register
 * @description
 * POST /api/v1/auth/register
 * Handles manual user registration via Email/Password.
 * WHY: Manual registration requires explicitly claiming a unique `username`. This endpoint 
 * catches preemptive conflicts (email/username taken) before Postgres creation.
 * 
 * @param {Object} req - Express request object containing registration details (email, username).
 * @param {Object} res - Express response object.
 * @returns {Promise<void>} Sends HTTP 201 with the created Postgres User object.
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
 * @function sync
 * @description
 * POST /api/v1/auth/sync
 * Syncs an authenticated Firebase session with the local Postgres database.
 * WHY: For social logins (Google/GitHub) or immediate post-signup, the frontend doesn't directly 
 * dictate Postgres schema. This endpoint securely auto-provisions or retrieves the Postgres User 
 * record purely based on the trusted Firebase token content.
 * 
 * @param {Object} req - Express request object. Token is extracted via headers.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>} Sends HTTP 200 with the synced Postgres User object.
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
 * @function getMe
 * @description
 * GET /api/v1/auth/me
 * Retrieves the currently authenticated user's profile.
 * WHY: Allows the frontend context to easily re-hydrate current user session state 
 * (like role, stats, premium status) without passing complex payloads. Fully respects `req.user`.
 * 
 * @param {Object} req - Express request object. Expects `req.user` attached by `authenticate` middleware.
 * @param {Object} res - Express response object.
 * @returns {Promise<void>} Sends HTTP 200 with the `req.user` object.
 */
const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, {
    message: "User profile retrieved.",
    data: req.user,
  });
});

module.exports = { register, sync, getMe };
