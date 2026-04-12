const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response");
const wordpressService = require("../services/wordpress.service");

const FRONTEND_URL = process.env.CLIENT_URL || "http://localhost:3000";

// ─── Initiate OAuth ──────────────────────────────────────────────────────────

/**
 * GET /api/wordpress/auth
 * Returns the WordPress.com OAuth authorization URL.
 * Frontend redirects the user to this URL.
 */
const initiateAuth = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const authUrl = wordpressService.initiateWordPressAuth(userId);
  sendSuccess(res, { authUrl }, "WordPress OAuth URL generated.");
});

// ─── OAuth Callback ──────────────────────────────────────────────────────────

/**
 * GET /api/wordpress/callback
 * WordPress.com redirects here after the user authorizes the app.
 * This is a browser redirect, so we redirect back to the frontend when done.
 */
const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  // If the user denied authorization
  if (error) {
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=error&wp_message=${encodeURIComponent(
        "WordPress authorization was denied."
      )}`
    );
  }

  if (!code || !state) {
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=error&wp_message=${encodeURIComponent(
        "Invalid callback parameters."
      )}`
    );
  }

  try {
    const connection = await wordpressService.handleWordPressCallback(
      code,
      state
    );
    // Redirect back to the profile edit page with a success flag
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=connected&wp_username=${encodeURIComponent(
        connection.wpUsername || ""
      )}&wp_site=${encodeURIComponent(connection.siteUrl || "")}`
    );
  } catch (err) {
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=error&wp_message=${encodeURIComponent(
        err.message || "WordPress connection failed."
      )}`
    );
  }
});

// ─── Check Connection Status ─────────────────────────────────────────────────

/**
 * GET /api/wordpress/status
 * Returns the current WordPress connection for the authenticated user.
 */
const getStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const connection = await wordpressService.getWordPressConnection(userId);

  if (!connection) {
    return sendSuccess(
      res,
      { connected: false },
      "WordPress is not connected."
    );
  }

  return sendSuccess(
    res,
    {
      connected: true,
      siteUrl: connection.siteUrl,
      wpUsername: connection.wpUsername,
      connectedAt: connection.connectedAt,
    },
    "WordPress is connected."
  );
});

// ─── Disconnect ──────────────────────────────────────────────────────────────

/**
 * DELETE /api/wordpress/disconnect
 * Removes the WordPress connection for the authenticated user.
 */
const disconnect = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  await wordpressService.disconnectWordPress(userId);
  sendSuccess(res, { disconnected: true }, "WordPress disconnected successfully.");
});

// ─── Schedule / Publish ──────────────────────────────────────────────────────

/**
 * POST /api/wordpress/publish
 * Body: { articleId, scheduledAt? }
 *   - scheduledAt omitted or null  → publish immediately
 *   - scheduledAt ISO string       → schedule for that time
 */
const publishToWordPress = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { articleId, scheduledAt } = req.body;

  if (!articleId) {
    return res.status(400).json({ success: false, message: "articleId is required." });
  }

  const result = await wordpressService.scheduleWordPressPublish(
    articleId,
    userId,
    scheduledAt ? new Date(scheduledAt) : null
  );

  const statusCode = result.success ? 200 : 502;
  res.status(statusCode).json({ success: result.success, data: result });
});

// ─── Get Publish Job Status ──────────────────────────────────────────────────

/**
 * GET /api/wordpress/publish-status/:articleId
 * Returns the WordPress publish job status for a given article.
 */
const getPublishStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { articleId } = req.params;

  const job = await wordpressService.getWordPressPublishStatus(
    articleId,
    userId
  );

  if (!job) {
    return sendSuccess(
      res,
      { found: false },
      "No WordPress publish job found for this article."
    );
  }

  return sendSuccess(res, { found: true, job }, "WordPress publish job fetched.");
});

module.exports = {
  initiateAuth,
  handleCallback,
  getStatus,
  disconnect,
  publishToWordPress,
  getPublishStatus,
};
