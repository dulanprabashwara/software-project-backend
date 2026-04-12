const asyncHandler = require("../utils/asyncHandler");
const prisma = require("../config/prisma");
const wordpressService = require("../services/wordpress.service");

const FRONTEND_URL = process.env.CLIENT_URL || "http://localhost:3000";

// GET /api/wordpress/auth — returns OAuth URL for frontend to redirect to
const initiateAuth = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const authUrl = wordpressService.initiateWordPressAuth(userId);
  // Use res.json() directly — sendSuccess in this codebase does not include data
  res.json({ success: true, data: { authUrl } });
});

// GET /api/wordpress/callback — WordPress.com redirects here after OAuth approval
const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

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
    const connection = await wordpressService.handleWordPressCallback(code, state);
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

// GET /api/wordpress/status — returns current connection state for the user
const getStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const connection = await wordpressService.getWordPressConnection(userId);

  if (!connection) {
    return res.json({ success: true, data: { connected: false } });
  }

  // Fetch avatar from our User record to display in the publish page
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { avatarUrl: true },
  });

  return res.json({
    success: true,
    data: {
      connected:   true,
      siteUrl:     connection.siteUrl,
      wpUsername:  connection.wpUsername,
      connectedAt: connection.connectedAt,
      avatarUrl:   user?.avatarUrl || null,
    },
  });
});

// DELETE /api/wordpress/disconnect — removes the WordPress connection
const disconnect = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  await wordpressService.disconnectWordPress(userId);
  res.json({ success: true, data: { disconnected: true } });
});

// POST /api/wordpress/publish — immediate or scheduled publish to WordPress
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

// GET /api/wordpress/publish-status/:articleId — returns latest job status
const getPublishStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { articleId } = req.params;

  const job = await wordpressService.getWordPressPublishStatus(articleId, userId);

  if (!job) {
    return res.json({ success: true, data: { found: false } });
  }

  return res.json({ success: true, data: { found: true, job } });
});

module.exports = {
  initiateAuth,
  handleCallback,
  getStatus,
  disconnect,
  publishToWordPress,
  getPublishStatus,
};
