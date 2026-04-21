const axios = require("axios");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");

// ─── WordPress.com OAuth2 + API Base URLs ────────────────────────────────────
// These two are static strings — safe as module-level consts.
const WP_OAUTH_BASE = "https://public-api.wordpress.com/oauth2";
const WP_API_BASE   = "https://public-api.wordpress.com/rest/v1.1";
//
// WORDPRESS_CLIENT_ID, WORDPRESS_CLIENT_SECRET, WORDPRESS_REDIRECT_URI are
// read from process.env INSIDE each function that needs them (not here).
// Reason: Jest loads modules once and caches them. If these were captured
// as module-level consts, any process.env changes made in beforeEach/afterEach
// would be invisible to the already-captured values, breaking tests.

// ─── Helper: strip protocol from URL ────────────────────────────────────────
const stripProtocol = (url = "") => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

// ─── Helper: build canonical link snippet ────────────────────────────────────
// Injected at the very top of the article content sent to WordPress.
// The <link> tag is picked up by SEO plugins (Yoast, Rank Math) and tells
// search engines that your platform is the original source.
// The HTML comment is human-readable only. Neither is visible to readers.
// This does NOT cause WordPress to reject the post.
const buildCanonicalSnippet = (article) => {
  const clientUrl = process.env.CLIENT_URL || "";
  if (!clientUrl || !article.slug) return "";
  const canonicalUrl = `${clientUrl}/article/${article.slug}`;
  return (
    `<!-- Originally published on Easy Blogger: ${canonicalUrl} -->\n` +
    `<link rel="canonical" href="${canonicalUrl}" />\n\n`
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  1. INITIATE OAUTH
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build the WordPress.com OAuth2 authorisation URL.
 * The userId is base64-encoded in the `state` param so the callback
 * knows which user to attach the resulting token to.
 */
const initiateWordPressAuth = (userId) => {
  const WP_CLIENT_ID    = process.env.WORDPRESS_CLIENT_ID;
  const WP_REDIRECT_URI = process.env.WORDPRESS_REDIRECT_URI;

  if (!WP_CLIENT_ID || !WP_REDIRECT_URI) {
    throw ApiError.internal(
      "WordPress integration is not configured on the server. " +
        "WORDPRESS_CLIENT_ID and WORDPRESS_REDIRECT_URI must be set in .env"
    );
  }

  const state = Buffer.from(JSON.stringify({ userId })).toString("base64url");

  const params = new URLSearchParams({
    client_id:     WP_CLIENT_ID,
    redirect_uri:  WP_REDIRECT_URI,
    response_type: "code",
    scope:         "posts auth",
    state,
  });

  return `${WP_OAUTH_BASE}/authorize?${params.toString()}`;
};

// ════════════════════════════════════════════════════════════════════════════
//  2. HANDLE OAUTH CALLBACK
// ════════════════════════════════════════════════════════════════════════════

/**
 * Exchange the authorisation code for an access token, fetch site info,
 * and persist the connection. Called once per user when they authorise
 * the app on WordPress.com. After this the connection is permanent until
 * the user explicitly disconnects.
 */
const handleWordPressCallback = async (code, stateParam) => {
  const WP_CLIENT_ID     = process.env.WORDPRESS_CLIENT_ID;
  const WP_CLIENT_SECRET = process.env.WORDPRESS_CLIENT_SECRET;
  const WP_REDIRECT_URI  = process.env.WORDPRESS_REDIRECT_URI;

  // Decode userId from state
  let userId;
  try {
    const decoded = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf8")
    );
    userId = decoded.userId;
  } catch {
    throw ApiError.badRequest("Invalid OAuth state parameter.");
  }
  if (!userId) throw ApiError.badRequest("Missing userId in OAuth state.");

  // Exchange code for access token
  let tokenData;
  try {
    const tokenRes = await axios.post(
      `${WP_OAUTH_BASE}/token`,
      new URLSearchParams({
        client_id:     WP_CLIENT_ID,
        client_secret: WP_CLIENT_SECRET,
        redirect_uri:  WP_REDIRECT_URI,
        code,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    tokenData = tokenRes.data;
  } catch (err) {
    const msg =
      err.response?.data?.error_description ||
      err.response?.data?.error ||
      "Failed to exchange OAuth code for token.";
    throw ApiError.badRequest(msg);
  }

  const accessToken = tokenData.access_token;
  const wpBlogId   = String(tokenData.blog_id);
  const wpBlogUrl  = tokenData.blog_url;

  // Fetch WordPress.com user profile for display name
  let wpUser;
  try {
    const meRes = await axios.get(`${WP_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    wpUser = meRes.data;
  } catch {
    throw ApiError.internal("Failed to fetch WordPress user profile.");
  }

  // Upsert connection — one user can have only one WordPress site.
  // If they reconnect with a different site the row is overwritten.
  const connection = await prisma.wordPressConnection.upsert({
    where:  { userId },
    update: {
      siteUrl:    wpBlogUrl,
      siteId:     wpBlogId,
      accessToken,
      wpUsername: wpUser.display_name || wpUser.username,
      wpEmail:    wpUser.email || null,
    },
    create: {
      userId,
      siteUrl:    wpBlogUrl,
      siteId:     wpBlogId,
      accessToken,
      wpUsername: wpUser.display_name || wpUser.username,
      wpEmail:    wpUser.email || null,
    },
  });

  // Mirror on User.wordpressAccountId for quick null-checks elsewhere
  await prisma.user.update({
    where: { id: userId },
    data:  { wordpressAccountId: wpBlogId },
  });

  return connection;
};

// ════════════════════════════════════════════════════════════════════════════
//  3. CHECK CONNECTION STATUS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns the WordPress connection record (without the access token) for a
 * user, or null if they have not connected.
 */
const getWordPressConnection = async (userId) => {
  return prisma.wordPressConnection.findUnique({
    where:  { userId },
    select: {
      id:          true,
      siteUrl:     true,
      siteId:      true,
      wpUsername:  true,
      wpEmail:     true,
      connectedAt: true,
      // accessToken intentionally omitted — never sent to frontend
    },
  });
};

// ════════════════════════════════════════════════════════════════════════════
//  4. DISCONNECT
// ════════════════════════════════════════════════════════════════════════════

const disconnectWordPress = async (userId) => {
  const conn = await prisma.wordPressConnection.findUnique({ where: { userId } });
  if (!conn) throw ApiError.notFound("No WordPress connection found.");

  await prisma.wordPressConnection.delete({ where: { userId } });
  await prisma.user.update({
    where: { id: userId },
    data:  { wordpressAccountId: null },
  });

  return { disconnected: true };
};

// ════════════════════════════════════════════════════════════════════════════
//  5. CORE PUBLISH FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST the full article to WordPress.com.
 *
 * Content fidelity:
 *  ✅ HTML structure (headings, bold, italic, lists, blockquotes)
 *  ✅ Inline images with absolute URLs
 *  ✅ Cover image → WordPress featured image
 *  ✅ Tags
 *  ✅ Canonical link injected at top for SEO
 *  ❌ Tailwind / CSS classes — ignored by WordPress theme (expected, unavoidable)
 *
 * Throws a plain Error (not ApiError) on failure so the caller can
 * catch it and decide whether to attempt a draft save.
 */
const pushArticleToWordPress = async (article, connection) => {
  const endpoint = `${WP_API_BASE}/sites/${connection.siteId}/posts/new`;

  const canonicalSnippet = buildCanonicalSnippet(article);
  const fullContent = canonicalSnippet + (article.content || "");

  const postBody = {
    title:   article.title,
    content: fullContent,
    status:  "publish",
    ...(article.tags?.length  && { tags: article.tags.join(",") }),
    ...(article.coverImage    && { featured_image: article.coverImage }),
  };

  let wpRes;
  try {
    const res = await axios.post(endpoint, postBody, {
      headers: {
        Authorization:  `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
    wpRes = res.data;
  } catch (err) {
    const errorMsg =
      err.response?.data?.message ||
      err.response?.data?.error   ||
      err.message                  ||
      "WordPress API request failed.";
    throw new Error(errorMsg);
  }

  return {
    wpPostId:  String(wpRes.ID),
    wpPostUrl: wpRes.URL,
  };
};

// ════════════════════════════════════════════════════════════════════════════
//  6. DRAFT SAVE FALLBACK  (called only when publish fails)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Attempts to save the article as a DRAFT on WordPress.
 * Only called when pushArticleToWordPress throws an error.
 *
 * Draft saves are more reliable than publish requests because WordPress
 * skips spam checks, scheduling validation, and content processing on drafts.
 *
 * On success: returns the URL of the WordPress posts/drafts dashboard,
 *             where the user can open the draft and click Publish in one step.
 * On failure: returns null — frontend then shows retry-only UI (no draft link).
 *
 * The user's article content is preserved exactly as in a normal publish.
 * They will NOT need to retype or copy anything.
 */
const attemptDraftSave = async (article, connection) => {
  const endpoint = `${WP_API_BASE}/sites/${connection.siteId}/posts/new`;
  const canonicalSnippet = buildCanonicalSnippet(article);

  try {
    await axios.post(
      endpoint,
      {
        title:   article.title,
        content: canonicalSnippet + (article.content || ""),
        status:  "draft",
        ...(article.tags?.length && { tags: article.tags.join(",") }),
        ...(article.coverImage   && { featured_image: article.coverImage }),
      },
      {
        headers: {
          Authorization:  `Bearer ${connection.accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    // The posts dashboard for this specific WordPress site.
    // The user will see their new draft at the top of the list.
    return `https://wordpress.com/posts/${stripProtocol(connection.siteUrl)}`;
  } catch {
    return null;
  }
};

// ════════════════════════════════════════════════════════════════════════════
//  7. SCHEDULE / IMMEDIATE PUBLISH  (main entry point from controller)
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param {string}    articleId   - Our article's database ID
 * @param {string}    userId      - Authenticated user's ID
 * @param {Date|null} scheduledAt - null = publish right now
 *
 * This function never throws to the controller — it always returns a result
 * object so the controller can pass structured success/failure data to the
 * frontend. ApiError is only thrown for validation failures (wrong user,
 * missing connection) which the controller's asyncHandler will catch.
 *
 * Return shape:
 * {
 *   success:      boolean
 *   message:      string
 *   wpPostId?:    string       on immediate success
 *   wpPostUrl?:   string       on immediate success
 *   draftUrl?:    string|null  on failure — link to WP drafts dashboard, or null
 *   jobId?:       string       on scheduled success
 *   scheduledAt?: string       on scheduled success
 * }
 */
const scheduleWordPressPublish = async (articleId, userId, scheduledAt) => {
  // ── Validate article ────────────────────────────────────────────────────
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw ApiError.notFound("Article not found.");
  if (article.authorId !== userId)
    throw ApiError.forbidden("You can only publish your own articles.");

  // ── Validate connection ─────────────────────────────────────────────────
  const connection = await prisma.wordPressConnection.findUnique({
    where: { userId },
  });
  if (!connection) {
    throw ApiError.badRequest(
      "WordPress is not connected. Please connect your WordPress account in Profile → Edit first."
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PATH A: Publish immediately
  // ══════════════════════════════════════════════════════════════════════
  if (!scheduledAt) {
    // Article must be PUBLISHED on our platform before pushing to WordPress
    if (article.status !== "PUBLISHED") {
      return {
        success:       false,
        failureReason: "not_published",
        message:       "Article has not been published on Easy Blogger yet. WordPress publish skipped.",
      };
    }

    try {
      const { wpPostId, wpPostUrl } = await pushArticleToWordPress(
        article,
        connection
      );

      await prisma.wordPressPublishJob.create({
        data: {
          articleId,
          userId,
          wpConnId:    connection.id,
          scheduledAt: new Date(),
          status:      "PUBLISHED",
          wpPostId,
          wpPostUrl,
          draftUrl:    null,
          errorMsg:    null,
        },
      });

      return {
        success:  true,
        message:  "Article published to WordPress successfully.",
        wpPostId,
        wpPostUrl,
      };
    } catch (publishErr) {
      // ── Attempt draft save so content is preserved ────────────────────
      // This runs ONLY when the publish call above threw an error.
      // If draft save also fails, draftUrl is null and the frontend shows
      // a retry button only (no "open draft" link).
      const draftUrl = await attemptDraftSave(article, connection);

      await prisma.wordPressPublishJob.create({
        data: {
          articleId,
          userId,
          wpConnId:    connection.id,
          scheduledAt: new Date(),
          status:      "FAILED",
          errorMsg:    publishErr.message,
          draftUrl,
        },
      });

      if (draftUrl) {
        // Draft was saved successfully — send the user to their WP drafts dashboard
        // to publish it manually. No retry needed, content is preserved.
        return {
          success:       false,
          failureReason: "publish",
          message:       `WordPress publish failed. Your article has been saved as a draft on WordPress.`,
          draftUrl,
        };
      }

      // Both publish AND draft save failed — frontend shows retry button only
      return {
        success:       false,
        failureReason: "both",
        message:       `WordPress publish failed: ${publishErr.message}`,
        draftUrl:      null,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PATH B: Schedule for later
  // ══════════════════════════════════════════════════════════════════════
  // If a PENDING or IN_PROGRESS job already exists for this article+user,
  // update its time rather than creating a duplicate.
  const existingJob = await prisma.wordPressPublishJob.findFirst({
    where: {
      articleId,
      userId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });

  // Lazy-require to avoid circular dependency (job module imports service module)
  const { registerJobTimeout, cancelJobTimeout } = require("../jobs/wordpress.job");

  if (existingJob) {
    await prisma.wordPressPublishJob.update({
      where: { id: existingJob.id },
      data: {
        scheduledAt: new Date(scheduledAt),
        wpConnId:    connection.id,
        status:      "PENDING",
        errorMsg:    null,
        draftUrl:    null,
      },
    });
    // Cancel the old timeout and register a new one at the updated time
    cancelJobTimeout(existingJob.id);
    registerJobTimeout(existingJob.id, new Date(scheduledAt));
    return {
      success:     true,
      message:     `WordPress publish rescheduled for ${new Date(scheduledAt).toISOString()}.`,
      jobId:       existingJob.id,
      scheduledAt: new Date(scheduledAt),
    };
  }

  const job = await prisma.wordPressPublishJob.create({
    data: {
      articleId,
      userId,
      wpConnId:    connection.id,
      scheduledAt: new Date(scheduledAt),
      status:      "PENDING",
    },
  });

  // Register the in-memory timeout — no cron polling needed
  registerJobTimeout(job.id, job.scheduledAt);

  return {
    success:     true,
    message:     `Article scheduled for WordPress publish at ${job.scheduledAt.toISOString()}.`,
    jobId:       job.id,
    scheduledAt: job.scheduledAt,
  };
};

// ════════════════════════════════════════════════════════════════════════════
//  8. GET PUBLISH JOB STATUS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns the most recent WordPress publish job for a given article.
 * Used by the frontend to show current status and retrieve
 * wpPostUrl (success), draftUrl (failure with saved draft),
 * or errorMsg (failure, draft also failed → show retry button only).
 */
const getWordPressPublishStatus = async (articleId, userId) => {
  return prisma.wordPressPublishJob.findFirst({
    where:   { articleId, userId },
    orderBy: { createdAt: "desc" },
    select: {
      id:          true,
      status:      true,
      wpPostId:    true,
      wpPostUrl:   true,
      draftUrl:    true,
      errorMsg:    true,
      scheduledAt: true,
      createdAt:   true,
    },
  });
};

// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  initiateWordPressAuth,
  handleWordPressCallback,
  getWordPressConnection,
  disconnectWordPress,
  pushArticleToWordPress,  // exported so wordpress.job.js can call it directly
  attemptDraftSave,        // exported so wordpress.job.js can call it directly
  scheduleWordPressPublish,
  getWordPressPublishStatus,
};