const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const authService = require("../services/auth.service");
const admin = require("../config/firebase");
const ApiError = require("../utils/ApiError");
const { logPlatformEvent } = require("../utils/eventLogger");

/**
 
 * Extracts and verifies the Firebase UID from an incoming Authorization header.
 */
const getUidFromToken = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Access denied. No token provided.");
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error("Firebase Token Verification Error in sync:", error);
    throw new ApiError(401, "Invalid or expired token.");
  }
};

/**
 
 * POST /api/v1/auth/register
 * Handles manual user registration via Email/Password.
 */
const register = asyncHandler(async (req, res) => {
  const { email, username, displayName, avatarUrl } = req.body;

  // Verify token to ensure legitimate registration
  const decodedToken = await getUidFromToken(req);
  const firebaseUid = decodedToken.uid;

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

  // --- PLATFORM PULSE TRIGGER ---
  await logPlatformEvent("NEW_USER", `A new user joined the platform: @${user.username}`);
  // ------------------------------

  sendSuccess(res, {
    statusCode: 201,
    message: "User registered successfully.",
    data: user,
  });
});

/**

 * POST /api/v1/auth/sync
for sign up and log in via google, facebook
 * Syncs an authenticated Firebase session with the local Postgres database.
 */
const sync = asyncHandler(async (req, res) => {
  // Securely get UID from verified token
  const decodedToken = await getUidFromToken(req);
  const firebaseUid = decodedToken.uid;
  const signInProvider = decodedToken.firebase?.sign_in_provider;

  const user = await authService.syncUser(firebaseUid);

  // --- STRICT ADMIN SECURITY POLICY ---
  // Block the login if the user is an Admin and tried to use a standard password.
  if (user.role === "ADMIN" && signInProvider === "password") {
    throw new ApiError(
      403,
      "Security Policy: Administrators must sign in using Google."
    );
  }

  // If the user has an active ban record, reject the login. return 403
  if (user.bannedRecord) {
    throw new ApiError(
      403,
      user.bannedRecord.reason ||
        "Your account has been suspended. Please contact support.",
    );
  }

  //--- PLATFORM PULSE TRIGGER ---
  // If the user's creation time is within the last 10 seconds, they just signed up
  const isNewUser = new Date().getTime() - new Date(user.createdAt).getTime() < 10000;
  if (isNewUser) {
    await logPlatformEvent("NEW_USER", `A new user joined via social login: @${user.username}`);
  }
  // ------------------------------

  sendSuccess(res, {
    message: "User synced successfully.",
    data: user,
  });
});

/**

 * GET /api/v1/auth/me
 * Retrieves the currently authenticated user's profile and send it to the frontend 
 */
const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, {
    message: "User profile retrieved.",
    data: req.user,
  });
});

module.exports = { register, sync, getMe };
