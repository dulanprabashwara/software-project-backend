// @ts-nocheck
const axios = require("axios");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

// ── CONSTANTS ───────────────────────────────────────────────────────

// Timeouts
const MEDIA_UPLOAD_TIMEOUT_MS = 30000;
const POST_PUBLISH_TIMEOUT_MS = 15000;

// API version
const WORDPRESS_API_VERSION = "rest/v1.1";

const WP_OAUTH_BASE = "https://public-api.wordpress.com/oauth2";
const WP_API_BASE   = "https://public-api.wordpress.com/" + WORDPRESS_API_VERSION;

const stripProtocol = (url = "") =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "");

// Prepends a canonical <link> tag to article content so search engines
// know Easy Blogger is the original source.
const buildCanonicalSnippet = (article) => {
  const clientUrl = process.env.CLIENT_URL || "";
  if (!clientUrl || !article.slug) return "";
  const canonicalUrl = `${clientUrl}/article/${article.slug}`;
  return `<!-- Originally published on Easy Blogger: ${canonicalUrl} -->\n<link rel="canonical" href="${canonicalUrl}" />\n\n`;
};

// Uploads the article cover image to the WordPress media library and returns the media ID.

const uploadCoverImageToWordPress = async (coverImage, connection) => {
  if (!coverImage) return null;

  const mediaEndpoint = `${WP_API_BASE}/sites/${connection.siteId}/media/new`;

  try {
    // Base64 data URL — extract binary and upload directly
    if (coverImage.startsWith("data:")) {
      const match = coverImage.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;

      const mimeType = match[1];
      const buffer   = Buffer.from(match[2], "base64");
      const ext      = mimeType.split("/")[1] || "jpg";

      // WordPress.com media API requires multipart/form-data, not raw binary
      const FormData = require("form-data");
      const form     = new FormData();
      form.append("media[]", buffer, { filename: `cover.${ext}`, contentType: mimeType });

      const res = await axios.post(mediaEndpoint, form, {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          ...form.getHeaders(),
        },
        timeout: 30000,
      });

      // Return the public URL — WordPress.com v1.1 featured_image expects a URL, not an integer ID
      return res.data?.media?.[0]?.URL || null;
    }

    // Absolute public URL — ask WordPress to sideload it
    if (coverImage.startsWith("http://") || coverImage.startsWith("https://")) {
      const res = await axios.post(
        mediaEndpoint,
        { url: coverImage },
        {
          headers: {
            Authorization:  `Bearer ${connection.accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: MEDIA_UPLOAD_TIMEOUT_MS,
        }
      );
      return res.data?.media?.[0]?.URL || null;
    }

    return null;
  } catch {
    return null;
  }
};

// Builds the post body for the WordPress REST API.
// featuredImageUrl: the WordPress-hosted URL returned by uploadCoverImageToWordPress.
// WordPress.com REST API v1.1 uses featured_image (URL), not featured_media (integer ID).
const buildWpPostBody = (article, status, featuredImageUrl = null) => {
  const canonical = buildCanonicalSnippet(article);
  return {
    title:   article.title,
    content: canonical + (article.content || ""),
    status,
    ...(article.tags?.length && { tags: article.tags.join(",") }),
    ...(featuredImageUrl     && { featured_image: featuredImageUrl }),
  };
};

// Generates the WordPress.com OAuth2 authorisation URL.
// The userId is encoded in the state param so the callback can identify the user.
const initiateWordPressAuth = (userId) => {
  const clientId    = process.env.WORDPRESS_CLIENT_ID;
  const redirectUri = process.env.WORDPRESS_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw ApiError.internal(
      "WordPress integration is not configured. WORDPRESS_CLIENT_ID and WORDPRESS_REDIRECT_URI must be set in .env"
    );
  }

  const state  = Buffer.from(JSON.stringify({ userId })).toString("base64url");
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "posts auth media",
    state,
  });

  return `${WP_OAUTH_BASE}/authorize?${params.toString()}`;
};

// Handles the OAuth callback from WordPress.com: exchanges the auth code for
// a token, fetches the user's WordPress profile, and saves the connection.
const handleWordPressCallback = async (code, stateParam) => {
  const clientId     = process.env.WORDPRESS_CLIENT_ID;
  const clientSecret = process.env.WORDPRESS_CLIENT_SECRET;
  const redirectUri  = process.env.WORDPRESS_REDIRECT_URI;

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8"));
    userId = decoded.userId;
  } catch {
    throw ApiError.badRequest("Invalid OAuth state parameter.");
  }
  if (!userId) throw ApiError.badRequest("Missing userId in OAuth state.");

  let tokenData;
  try {
    const res = await axios.post(
      `${WP_OAUTH_BASE}/token`,
      new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, grant_type: "authorization_code" }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    tokenData = res.data;
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || "Failed to exchange OAuth code for token.";
    throw ApiError.badRequest(msg);
  }

  const accessToken = tokenData.access_token;
  const wpBlogId    = String(tokenData.blog_id);
  const wpBlogUrl   = tokenData.blog_url;

  let wpUser;
  try {
    const res = await axios.get(`${WP_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    wpUser = res.data;
  } catch {
    throw ApiError.internal("Failed to fetch WordPress user profile.");
  }

  const connectionData = {
    siteUrl:           wpBlogUrl,
    siteId:            wpBlogId,
    accessToken,
    wpUsername:        wpUser.display_name || wpUser.username,
    wpEmail:           wpUser.email || null,
    wpProfilePicture:  wpUser.avatar_URL   || null,
  };

  const connection = await prisma.wordPressConnection.upsert({
    where:  { userId },
    update: connectionData,
    create: { userId, ...connectionData },
  });

  await prisma.user.update({
    where: { id: userId },
    data:  { wordpressAccountId: wpBlogId },
  });

  return connection;
};

// Returns the user's WordPress connection details, or null if not connected.
// The access token is intentionally excluded from the returned fields.
const getWordPressConnection = async (userId) => {
  return prisma.wordPressConnection.findUnique({
    where:  { userId },
    select: { id: true, siteUrl: true, siteId: true, wpUsername: true, wpEmail: true, wpProfilePicture: true, connectedAt: true },
  });
};

// Removes the user's WordPress connection from the database.
const disconnectWordPress = async (userId) => {
  const conn = await prisma.wordPressConnection.findUnique({ where: { userId } });
  if (!conn) throw ApiError.notFound("No WordPress connection found.");

  await prisma.wordPressConnection.delete({ where: { userId } });
  await prisma.user.update({ where: { id: userId }, data: { wordpressAccountId: null } });

  return { disconnected: true };
};

// Sends the article to WordPress as a published post.
// Tries to set the cover image as featured image via media upload.
// If upload fails, falls back to passing the original URL directly (works for public URLs after hosting).
const pushArticleToWordPress = async (article, connection) => {
  let featuredImageUrl = await uploadCoverImageToWordPress(article.coverImage, connection);

  // Fallback: if media upload failed but coverImage is already a public URL, use it directly
  if (!featuredImageUrl && article.coverImage?.startsWith("http")) {
    featuredImageUrl = article.coverImage;
  }

  let wpRes;
  try {
    const res = await axios.post(
      `${WP_API_BASE}/sites/${connection.siteId}/posts/new`,
      buildWpPostBody(article, "publish", featuredImageUrl),
      {
        headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json" },
        timeout: POST_PUBLISH_TIMEOUT_MS,
      }
    );
    wpRes = res.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || err.response?.data?.error || err.message || "WordPress API request failed."
    );
  }

  return { wpPostId: String(wpRes.ID), wpPostUrl: wpRes.URL };
};

// Saves the article as a draft on WordPress when publish fails.
// Returns the WordPress posts dashboard URL so the user can manually publish it.
const attemptDraftSave = async (article, connection) => {
  try {
    let featuredImageUrl = await uploadCoverImageToWordPress(article.coverImage, connection);
    if (!featuredImageUrl && article.coverImage?.startsWith("http")) {
      featuredImageUrl = article.coverImage;
    }

    await axios.post(
      `${WP_API_BASE}/sites/${connection.siteId}/posts/new`,
      buildWpPostBody(article, "draft", featuredImageUrl),
      {
        headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json" },
        timeout: POST_PUBLISH_TIMEOUT_MS,
      }
    );
    return `https://wordpress.com/posts/${stripProtocol(connection.siteUrl)}`;
  } catch {
    return null;
  }
};

// Handles immediate or scheduled WordPress publishing for an article.
// For immediate publish (scheduledAt = null), calls WordPress right away.
// For scheduled publish, creates a PENDING job and registers an in-memory timer.
const scheduleWordPressPublish = async (articleId, userId, scheduledAt) => {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");
  if (article.authorId !== userId) throw ApiError.forbidden("You can only publish your own articles.");

  const connection = await prisma.wordPressConnection.findUnique({ where: { userId } });
  if (!connection) {
    throw ApiError.badRequest("WordPress is not connected. Please connect in Profile → Edit first.");
  }

  const jobBase = { articleId, userId, wpConnId: connection.id };

  if (!scheduledAt) {
    if (article.status !== "PUBLISHED") {
      return {
        success:       false,
        failureReason: "not_published",
        message:       "Article has not been published on Easy Blogger yet. WordPress publish skipped.",
      };
    }

    try {
      const { wpPostId, wpPostUrl } = await pushArticleToWordPress(article, connection);
      await prisma.wordPressPublishJob.create({
        data: { ...jobBase, scheduledAt: new Date(), status: "PUBLISHED", wpPostId, wpPostUrl, draftUrl: null, errorMsg: null },
      });
      return { success: true, message: "Article published to WordPress successfully.", wpPostId, wpPostUrl };
    } catch (publishErr) {
      const draftUrl = await attemptDraftSave(article, connection)
        || `https://wordpress.com/posts/${connection.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
      await prisma.wordPressPublishJob.create({
        data: { ...jobBase, scheduledAt: new Date(), status: "FAILED", errorMsg: publishErr.message, draftUrl },
      });

      if (draftUrl) {
        return { success: false, failureReason: "publish", message: "WordPress publish failed. Your article has been saved as a draft on WordPress.", draftUrl };
      }
      return { success: false, failureReason: "both", message: `WordPress publish failed: ${publishErr.message}`, draftUrl: null };
    }
  }

  const { registerJobTimeout, cancelJobTimeout } = require("../jobs/wordpress.job");

  const existingJob = await prisma.wordPressPublishJob.findFirst({
    where: { articleId, userId, status: { in: ["PENDING", "IN_PROGRESS"] } },
  });

  if (existingJob) {
    await prisma.wordPressPublishJob.update({
      where: { id: existingJob.id },
      data:  { scheduledAt: new Date(scheduledAt), wpConnId: connection.id, status: "PENDING", errorMsg: null, draftUrl: null },
    });
    cancelJobTimeout(existingJob.id);
    registerJobTimeout(existingJob.id, new Date(scheduledAt));
    return { success: true, message: `WordPress publish rescheduled for ${new Date(scheduledAt).toISOString()}.`, jobId: existingJob.id, scheduledAt: new Date(scheduledAt) };
  }

  const job = await prisma.wordPressPublishJob.create({
    data: { ...jobBase, scheduledAt: new Date(scheduledAt), status: "PENDING" },
  });
  registerJobTimeout(job.id, job.scheduledAt);

  return { success: true, message: `Article scheduled for WordPress publish at ${job.scheduledAt.toISOString()}.`, jobId: job.id, scheduledAt: job.scheduledAt };
};

// Returns the most recent WordPress publish job for a given article.
const getWordPressPublishStatus = async (articleId, userId) => {
  return prisma.wordPressPublishJob.findFirst({
    where:   { articleId, userId },
    orderBy: { createdAt: "desc" },
    select:  { id: true, status: true, wpPostId: true, wpPostUrl: true, draftUrl: true, errorMsg: true, scheduledAt: true, createdAt: true },
  });
};

module.exports = {
  initiateWordPressAuth,
  handleWordPressCallback,
  getWordPressConnection,
  disconnectWordPress,
  pushArticleToWordPress,
  attemptDraftSave,
  scheduleWordPressPublish,
  getWordPressPublishStatus,
};