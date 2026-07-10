const linkedinService = require("../services/linkedin.service");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Redirects the user to the LinkedIn OAuth 2.0 authorization page.
 */
const initiateAuth = asyncHandler(async (req, res) => {
  const returnTo = req.query.returnTo || "/profile/edit";
  const authUrl = linkedinService.initiateLinkedInAuth(req.user.id, returnTo);
  res.json({ success: true, data: { authUrl } });
});

/**
 * Handles the OAuth callback from LinkedIn.
 */
const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  let returnToPath = "/profile/edit";
  try {
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
      if (decoded.returnTo) returnToPath = decoded.returnTo;
    }
  } catch (e) {}

  if (error) {
    const msg = error_description || "LinkedIn authentication failed.";
    return res.redirect(`${process.env.CLIENT_URL}${returnToPath}?li_status=error&li_message=${encodeURIComponent(msg)}`);
  }

  const { connection, returnTo } = await linkedinService.handleLinkedInCallback(code, state);

  // Redirect back to frontend with success status
  res.redirect(
    `${process.env.CLIENT_URL}${returnTo}?li_status=connected&li_username=${encodeURIComponent(connection.liDisplayName)}&li_picture=${encodeURIComponent(connection.liProfilePicture || "")}`
  );
});

/**
 * Returns the user's LinkedIn connection status.
 */
const getStatus = asyncHandler(async (req, res) => {
  const connection = await linkedinService.getLinkedInConnection(req.user.id);
  res.json({
    success: true,
    data: {
      connected: !!connection,
      liUsername: connection?.liDisplayName || null,
      liPicture: connection?.liProfilePicture || null,
    },
  });
});

/**
 * Disconnects LinkedIn.
 */
const disconnect = asyncHandler(async (req, res) => {
  await linkedinService.disconnectLinkedIn(req.user.id);
  res.json({ success: true, message: "LinkedIn disconnected successfully." });
});

/**
 * Publishes an article to LinkedIn.
 */
const publishArticle = asyncHandler(async (req, res) => {
  const { articleId, scheduledAt, caption } = req.body;
  const result = await linkedinService.scheduleLinkedInPublish(articleId, req.user.id, scheduledAt, caption);
  res.json({ success: true, data: result });
});

/**
 * Gets the publish status of an article on LinkedIn.
 */
const getPublishStatus = asyncHandler(async (req, res) => {
  const { articleId } = req.params;
  const status = await linkedinService.getLinkedInPublishStatus(articleId, req.user.id);
  res.json({ success: true, data: status });
});

module.exports = {
  initiateAuth,
  handleCallback,
  getStatus,
  disconnect,
  publishArticle,
  getPublishStatus,
};
