// @ts-nocheck
// src/controllers/wordpress.controller.js
// Handles HTTP requests for WordPress OAuth, connection status, and article publishing.

const asyncHandler    = require("../utils/asyncHandler");
const prisma          = require("../config/prisma");
const wordpressService = require("../services/wordpress.service");

// ── CONSTANTS ───────────────────────────────────────────────────────

const HTTP_STATUS_OK          = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_BAD_GATEWAY = 502;

const FRONTEND_URL = process.env.CLIENT_URL || "http://localhost:3000";

// ── AUTH ─────────────────────────────────────────────────────────────

// Returns the WordPress.com OAuth URL the frontend uses to start the connection flow.
const initiateAuth = asyncHandler(async (req, res) => {
  const authUrl = wordpressService.initiateWordPressAuth(req.user.id);
  res.json({ success: true, data: { authUrl } });
});

// Receives the OAuth callback from WordPress.com, saves the connection, and redirects the browser back to the frontend.
const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=error&wp_message=${encodeURIComponent("WordPress authorization was denied.")}`
    );
  }

  if (!code || !state) {
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=error&wp_message=${encodeURIComponent("Invalid callback parameters.")}`
    );
  }

  try {
    const connection = await wordpressService.handleWordPressCallback(code, state);
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=connected` +
      `&wp_username=${encodeURIComponent(connection.wpUsername || "")}` +
      `&wp_site=${encodeURIComponent(connection.siteUrl || "")}` +
      `&wp_picture=${encodeURIComponent(connection.wpProfilePicture || "")}`
    );
  } catch (err) {
    return res.redirect(
      `${FRONTEND_URL}/profile/edit?wp_status=error&wp_message=${encodeURIComponent(err.message || "WordPress connection failed.")}`
    );
  }
});

// ── CONNECTION ────────────────────────────────────────────────────────

// Returns whether the user has a WordPress site connected, along with site and profile details.
const getStatus = asyncHandler(async (req, res) => {
  const connection = await wordpressService.getWordPressConnection(req.user.id);

  if (!connection) {
    return res.json({ success: true, data: { connected: false } });
  }

  // Fetch the user's Easy Blogger avatar separately for display alongside the WP profile
  const user = await prisma.user.findUnique({
    where:  { id: req.user.id },
    select: { avatarUrl: true },
  });

  return res.json({
    success: true,
    data: {
      connected:        true,
      siteUrl:          connection.siteUrl,
      wpUsername:       connection.wpUsername,
      wpProfilePicture: connection.wpProfilePicture || null,
      connectedAt:      connection.connectedAt,
      avatarUrl:        user?.avatarUrl || null,
    },
  });
});

// Removes the user's WordPress connection.
const disconnect = asyncHandler(async (req, res) => {
  await wordpressService.disconnectWordPress(req.user.id);
  res.json({ success: true, data: { disconnected: true } });
});

// ── PUBLISHING ────────────────────────────────────────────────────────

// Publishes an article to WordPress now, or schedules it if scheduledAt is provided.
const publishToWordPress = asyncHandler(async (req, res) => {
  const { articleId, scheduledAt } = req.body;

  if (!articleId) {
    return res.status(HTTP_STATUS_BAD_REQUEST).json({ success: false, message: "articleId is required." });
  }

  const result = await wordpressService.scheduleWordPressPublish(
    articleId,
    req.user.id,
    scheduledAt ? new Date(scheduledAt) : null
  );

  res.status(result.success ? HTTP_STATUS_OK : HTTP_STATUS_BAD_GATEWAY).json({
    success: result.success,
    data:    result,
  });
});

// Returns the latest WordPress publish job record for the given article.
const getPublishStatus = asyncHandler(async (req, res) => {
  const job = await wordpressService.getWordPressPublishStatus(req.params.articleId, req.user.id);

  if (!job) {
    return res.json({ success: true, data: { found: false } });
  }

  return res.json({ success: true, data: { found: true, job } });
});

module.exports = { initiateAuth, handleCallback, getStatus, disconnect, publishToWordPress, getPublishStatus };